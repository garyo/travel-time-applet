# Travel Time Monitor

This is a simple applet to monitor driving time to fixed locations, along with MBTA Red Line status at certain stations.

It uses a Cloudflare Worker to call the Google Route API to get drive time and distance.

# Dev Notes
I use `bun` as JS package manager/runtime, so rather than installing `wrangler` (the cloudflare CLI tool) globally, I use `bunx wrangler ...` everywhere.

* Deploy worker to Cloudflare:
```
cd travel-time-worker
wrangler deploy
```

* Run worker locally:
```
cd travel-time-worker
wrangler dev
```

I use `uv` as my python package-manager/python-version/venv manager to simplify things
* Run front-end server:
```
cd public
uv run livereload .
```
This will auto-install the python deps and run the server, auto-reloading on file changes. 

* Deploy front end page to Cloudflare Pages:
```
wrangler pages deploy public
```

# Config and secrets

* Log in to Cloudflare with `wrangler login`
* Add your Google Maps API key with `wrangler secret set GOOGLE_API_KEY`
* Copy `travel-time-worker/config.js.sample` to `travel-time-worker/config.js` and set up your addresses there.

# Live Demo
* https://travel-time-applet.pages.dev/
