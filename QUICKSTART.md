# Quick Start Guide: Running Reading Mate on a New Computer

This package contains all the source code, assets, configuration, and worker logic for **Reading Mate**.

---

## 1. Requirements on the New Computer

Before starting, make sure the target computer has:
1. **Node.js**: LTS version (Node.js 18 or 20+ recommended) — [nodejs.org](https://nodejs.org/)
2. **Git** (optional, but recommended)
3. **Expo Go** (optional, install on iOS / Android from App Store / Google Play if you want to test on your phone)

---

## 2. Setup & Running the App

1. **Extract the ZIP file** to any folder on your computer.
2. Open a terminal (PowerShell, Command Prompt, or Bash) in the project folder:
   ```bash
   cd reading-mate
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Start the Expo development server**:
   ```bash
   npm start
   # or: npx expo start
   ```
5. **Open the app**:
   - **In a Web Browser**: Press `w` in your terminal to open the web version.
   - **On Mobile (Expo Go)**:
     - Android: Scan the QR code shown in the terminal with the Expo Go app.
     - iOS: Scan the QR code using the default Camera app and tap the Expo banner.

---

## 3. Cloudflare Worker (Optional - For Attachments / Uploads)

If you need to deploy or test the Cloudflare Worker handling Backblaze B2 uploads:
1. Open a terminal in the `worker/` subdirectory:
   ```bash
   cd worker
   ```
2. Install worker dependencies:
   ```bash
   npm install
   ```
3. Run locally with Wrangler:
   ```bash
   npx wrangler dev
   ```

---

## 4. Setting Up Your Gemini API Key

Once the app opens:
1. Sign up or log in (Firebase Auth is pre-configured).
2. Go to the **Settings** tab.
3. Enter your free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
4. The key is securely saved to your user profile and you're ready to read!
