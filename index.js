/* eslint-env es6 */
/* eslint no-console: 0 */
'use strict';

require('dotenv').config();
const express = require('express');
const exphbs = require('express-handlebars');
const app = express();
const getRSSItem = require('./lib/get-rss-item');
const getSearch = require('./lib/search');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const csp = require('helmet-csp');
const audioProxy = require('./lib/audio-proxy');
const redisSplit = require('redis-url').parse(process.env.REDIS_SERVER);
const cache = require('express-redis-cache')({
	host: redisSplit.hostname, port: Number(redisSplit.port), auth_pass: redisSplit.password
});

app.set('json spaces', 2);
app.use(helmet());
app.use(csp({
	// Specify directives as normal.
	directives: {
		defaultSrc: ['\'self\'', 'http:', 'https:'],
		scriptSrc: ['\'self\'', '\'unsafe-inline\'', 'https://cdn.polyfill.io'],
		styleSrc: ['\'self\'', 'https://fonts.googleapis.com'],
		fontSrc: ['\'self\'', 'https://fonts.gstatic.com'],
		imgSrc: ['data:', 'https:'],
		reportUri: '/report-violation',
		frameAncestors: ['none'],

		objectSrc: [], // An empty array allows nothing through
	},

	// Set to true if you want to set all headers: Content-Security-Policy,
	// X-WebKit-CSP, and X-Content-Security-Policy.
	setAllHeaders: true,

	// Set to true if you want to disable CSP on Android where it can be buggy.
	disableAndroid: false,

	// Set to false if you want to disable any user-agent sniffing.
	// This may make the headers less compatible but it will be much faster.
	// This defaults to `true`. Should be false if behind cdn.
	browserSniff: false
}));

// Use Handlebars for templating
const hbs = exphbs.create({
	defaultLayout: 'v1',
	helpers: {
		ifEq: function(a, b, options) {
			return (a === b) ? options.fn(this) : options.inverse(this);
		},
		mangle: function(options) {
			return options.fn(this).replace(/[^a-z0-9]+/ig,'-');
		},
		bytesToMegabytes: function(options) {
			return (Number(options.fn(this)) / (1024 * 1024)).toFixed(2) + 'MB';
		},
		encodeURIComponent: function(options) {
			return encodeURIComponent(options.fn(this));
		}
	}
});

app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');

app.get('/audioproxy/', audioProxy);

app.get('/:version/search', cache.route(3600*24*30), function(req, res) {
	const shoudDebug = !!req.query.debug;
	getSearch(req.query.term)
		.then(function(result) {
			result.layout = req.params.version;
			result.term = req.query.term;
			res.render(shoudDebug ? 'search-debug' : 'search', result);
		})
		.catch(function(err) {
			res.status(400);
			res.render('error', {
				message: err.message,
				layout: req.params.version
			});
		});
});

app.get('/:version/feed', cache.route(3600), function(req, res) {
	if (req.query.url) {
		let url = req.query.url;
		if (url.match(/^https?%3A%2F%2F/i)) {
			url = decodeURIComponent(url);
		}
		return getRSSItem(url)
			.then(function(items) {
				const shoudDebug = !!req.query.debug;
				const shoudJson = !!req.query.json;

				items.size = req.query.size || 'full';
				items.url = url;

				items.items.forEach(item => {
					if (item.enclosures && !item['media:content']) {
						item['media:content'] = item.enclosures;
					}
				});

				items.layout = req.params.version;
				items.title = items.meta.title;
				if (shoudJson) {
					return res.json(items);
				}
				res.render(shoudDebug ? 'feed-debug' : 'feed', items);
			}, function(err) {
				res.status(400);
				res.render('error', {
					message: err.message,
					url: url,
					layout: req.params.version
				});
			});
	}
	res.status(400);
	res.render('error', {
		message: 'Invalid RSS URL',
		layout: req.params.version
	});
});

app.get('/:version', function(req, res) {
	res.render('index', {
		layout: req.params.version
	});
});

app.get('/', function(req, res) {
	res.redirect('/v4/');
});

app.use(bodyParser.json({
	type: ['json', 'application/csp-report']
}));

app.post('/report-violation', function(req, res) {
	if (req.body) {
		console.log('CSP Violation: ', req.body)
	} else {
		console.log('CSP Violation: No data received!')
	}
	res.status(204).end()
});

app.use('/static', express.static(__dirname + '/static', {
	maxAge: 3600*1000*24
}));

app.listen(process.env.PORT || 3000);
