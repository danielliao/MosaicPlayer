# Synchronized media transitions

Program content accepts `transition: {type: "cut", durationMs: 0}` (default) or `{type: "fade", durationMs: 500}`. Fade duration is an integer from 100 to 2000 ms and at most half the shortest normalized visual item. Audio/music cursors and segment durations are unchanged. A fade uses the incoming segment epoch; a delayed screen joins the current progress or cuts if the window has elapsed.

The browser, Android and macOS implementations preserve outgoing visible content while the incoming image/video prepares, then reveal the incoming content. Freeze-frame overlays avoid keeping two videos decoding throughout a fade. Image→image, image→video, video→image and video→video use the same semantics. Missing/failed preloads retain prior content; joining with no prior frame does not fade from black. Repeating the same asset without a renderer replacement does not introduce an artificial transition.

The fade is visual only: the outgoing video pauses/releases on replacement, video audio cuts directly, and independent background music keeps its timeline. Native freeze frames are bounded to a 2048-pixel longest edge.

The browser preloads the next scheduled visual up to three seconds before its boundary. Cached assets and preloading reduce stalls but cannot guarantee frame lock between independent displays. Old players that ignore the optional transition field continue to cut. Initial direct/manual playback defaults to cut; configure transitions in scheduled program content.

First-frame protection and transitional overlays conservatively suppress complete-play receipts for affected partial segments. A preview simulates the timeline and is not proof of physical screen output. Hardware acceptance must include repeated image/video boundaries on mixed landscape/portrait walls, offline playback, decoder failures, late joining, and low-memory TVs.
