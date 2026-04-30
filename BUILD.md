# World Clock Widget — Build Instructions

## Prerequisites
- [Node.js](https://nodejs.org/) v18 or later (includes npm)

## Development (run without installing)
```
cd timezone-widget
npm install
npm start
```

## Build a Windows installer (.exe)
```
cd timezone-widget
npm install
npm run build:installer
```

The installer will be generated at:
```
timezone-widget/dist/World Clock Widget Setup 1.0.0.exe
```

Double-click it to install. The app will be added to your Start Menu and Desktop.

## Optional: add a custom icon
Place a 256×256 `icon.ico` file at `timezone-widget/assets/icon.ico` before building.
