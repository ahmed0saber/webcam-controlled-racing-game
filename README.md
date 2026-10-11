# Air Steering Wheel

A browser arcade racer. Hold your hands up like a steering wheel, and the webcam turns that motion into steering. Keyboard play works with no camera at all.

The game is static HTML, CSS, and JavaScript. There is no build step and no server-side game logic. Webcam frames are processed in the browser and are never uploaded.

## Run it

Open the folder in a terminal and start a static server. ES modules and camera access do not work from a `file://` URL.

Windows:

```powershell
cd "C:\Users\h p\Desktop\Air Steering Wheel - Webcam-Controlled Racing Game"
py -m http.server 8080
```

macOS or Linux:

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

Any other static server is fine. Deploy the folder as-is to an HTTPS host. Camera access works on localhost during development and requires HTTPS in production.

## Play

**Camera**

1. Choose **Play with camera**.
2. Choose **Enable camera** and allow the prompt. Pick **NVIDIA Broadcast**, or any other camera, from the camera list. The preview is mirrored.
3. Show both hands, palms toward the camera. Steering follows the tilt between your palms.
4. Hold the imaginary wheel straight. After about a second of steady samples, the race starts.
5. Turning left steers the car left. Turning right steers right.

**Keyboard**

- A or Left Arrow, D or Right Arrow: steer
- W or Up Arrow: accelerate
- S or Down Arrow: brake
- The car cruises if you only steer
- Space: pause or resume
- Esc: pause menu

On a touch screen, Left, Right, Gas, and Brake buttons appear during a race.

Recalibrate any time from the dock or the pause menu. The best score, sound setting, and steering sensitivity are stored in `localStorage`.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| Blank page or module errors | Use a local HTTP server. Do not open `index.html` directly. |
| Camera button does nothing useful | Allow camera permission in the site settings, then click **Enable camera** again. |
| No camera found | Plug in a webcam, start NVIDIA Broadcast, or choose **Play with keyboard**. |
| NVIDIA Broadcast is missing | Leave the NVIDIA Broadcast app running, then choose **NVIDIA Broadcast** in the camera list. It is the same virtual camera Meet, Zoom, and Teams use. |
| Camera in use | Close other apps that hold the webcam. |
| Hand model fails to load | The first camera start downloads MediaPipe. Check your connection, then try again. Keyboard mode still works offline after the page itself has loaded. |
| Steering feels backwards | Use the mirrored preview. Your left hand should appear on the left. Recalibrate while holding the wheel straight. |
| Steering jitters | Lower the sensitivity slider and keep both palms toward the camera. Small motion inside the dead zone is ignored. |
| Tracking lost | The wheel holds briefly, then returns to center. Bring both hands back into view. It will not snap to full lock. |
| Page was hidden | The race pauses so time does not jump when you come back. Press Resume. |
| Best score did not save | The browser may be blocking storage. The score still shows for the current visit. |

## External dependencies

Loaded only after you enable the camera:

- [@mediapipe/tasks-vision 0.10.20](https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20) from jsDelivr, including its WASM files
- [Hand landmarker](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) from Google’s MediaPipe model host

Sound effects are synthesized with the Web Audio API. No audio files are required. The car, road, traffic, and coins are drawn on a canvas.

## Layout

- `index.html` — page, HUD, menus
- `css/styles.css` — layout and theme
- `js/main.js` — startup, states, and input
- `js/game.js` — race simulation
- `js/renderer.js` — canvas drawing
- `js/pose-tracker.js` — webcam and MediaPipe
- `js/steering.js` — wheel angle, calibration, and smoothing
- `js/audio.js` — synthesized sound
- `js/storage.js` — best score and preferences
