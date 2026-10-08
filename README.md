# NEON RALLY — Three.js + WebSocket multiplayer

## What's included
- `embed.html` — paste **the entire contents** into a Webflow Embed element.
- `server.js` — authoritative Node.js + WebSocket game server.
- `package.json` — Node dependencies and startup command.

## Deployment
1. Create a Node.js web service on Render, Railway, Fly.io, VPS, or another host that supports persistent WebSocket connections (NOT a static site or a request-only serverless function).
2. Upload `server.js` and `package.json` to that service. Install dependencies using `npm install` and start with `npm start`. Node.js >=20 is required.
3. Your host normally provides an HTTPS public hostname. For example `https://game.example.com` corresponds to `wss://game.example.com`.
4. In `embed.html`, set:
   `const WS_URL = 'wss://game.example.com';`
5. Paste the entire updated `embed.html` into one Webflow Embed and publish.
6. Optional recommended server environment variable: `ALLOWED_ORIGINS=https://example.com,https://www.example.com`. Include the Webflow staging origin if necessary.
7. Visit the published page from two browsers or devices, pick distinct nicknames, create and join a table, then click Ready in both windows within 10 seconds.

## Mechanics
- Always renders the local player's side at the bottom, opponent's at the top, with 180° scene rotation for player two.
- Player can move anywhere in their own half, with enforced server-side max speed.
- On serve, the ball is stationary in the middle near the backline. Move the paddle into it to strike; horizontal stroke and impact offset affect shot direction.
- Only one side-wall bounce between hits, and it must happen in the opponent's half. Multiple paddle contacts on the same half without a return are a foul.
- A missed ball exits through the goal line: the opponent scores.
- Winner serves next; game ends at 9+ points with a 2-point advantage.
- The Ready timer is 10 seconds. Unready user is kicked; if neither is ready the host can be removed as well.
- If a client drops during play, the match pauses up to 15 seconds. Reloading within that period and reusing the same browser tab session token can restore play; if not, remaining player gets the win.

## Scope / caveats
- This is a functional *prototype* and not production-hardened: in-memory rooms disappear on server restart, no authentication, rate limiting or cheat analytics, and the paddle/ball collisions are 2D table-top collisions. “Double touch” is implemented as double paddle contact, not a vertical table-floor bounce. Physics/graphics integration and real two-device connectivity should be tested on the deployed domain.
- Sound, touch joysticks, statistics, matchmaking, and spectators are not included.
