# Palate — app assets

This folder needs two image files. Until they exist, Expo will warn but still run.

## icon.png
- Square PNG, **1024×1024**, no transparency.
- Brand red background `#FF3008` with a white lowercase "p" in the center.
- Used for the iOS Home-screen icon and Android adaptive icon foreground.

## splash.png
- **1284×2778** PNG (iPhone 13 Pro Max baseline).
- White background `#FFFFFF`.
- Centered Palate logo (the red "p" tile from the landing page) at roughly 200 px wide.

## Quick way to generate them
1. Open Figma (free).
2. Make a 1024×1024 frame, fill it with `#FF3008`, drop in a white "p" with the SF Pro font, weight 800. Export as `icon.png`.
3. Make a 1284×2778 frame, white, drop in the same logo small in the middle. Export as `splash.png`.
4. Put both files in this folder and rerun `npx expo start`.

If you want to skip this for now, drop in any 1024×1024 and 1284×2778 PNG named `icon.png` and `splash.png` so Expo stops warning. We'll polish before the App Store.
