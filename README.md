# NEON RALLY — portrait 1:2 edition

## Changes
- 72 × 144 portrait playfield, centred Webflow embed with 1:2 ratio.
- Large visible ball and styled air-hockey mallets.
- Smoothed client-side interpolation between network updates; capped renderer pixel density.
- Adjusted server coordinates, speed, collision sizes and serve placement.

## Deploy
1. Replace `server.js` and `package.json` in your GitHub repository. Commit changes.
2. Render redeploys the latest commit (or select Manual Deploy → Deploy latest commit).
3. Edit `embed.html`: change `WS_URL` to your existing `wss://...onrender.com` address.
4. Replace the COMPLETE previous code in Webflow Code Embed with the contents of `embed.html`, save and publish.
5. Test in two tabs / browsers. The two clients must connect to the same server deployment.

**Important:** Updating the Embed only will NOT work with the previous server: playfield dimensions changed.

Webflow Code Embed code size: under 50,000 characters. Client-side network interpolation reduces visual jitter but does not eliminate internet latency or cold starts on free hosts.
