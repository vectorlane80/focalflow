# FocalFlow

FocalFlow is a Chrome extension for distraction-free reading. It extracts the active page into a clean reader shell and offers an RSVP (Rapid Serial Visual Presentation) mode for fast, focused consumption.

## Features

- Extraction-first reader shell built from Mozilla Readability output.
- RSVP playback with ORP-aligned word display, calibrated punctuation pauses, and back/forward navigation.
- Bionic Reading toggle with a per-user default (always on, always off, or remember last).
- Optional auto-start RSVP so the reader begins playback immediately.
- Per-article resume: reopens at the last word you read.
- WPM speed persists across sessions.
- Narrow permissions: `activeTab`, `scripting`, `storage`.

## Project Structure

- `manifest.json`: MV3 extension entry point.
- `src/popup/`: popup UI that injects the extraction runtime on demand.
- `src/content/`: extraction, reader shell, and runtime wiring.
- `src/vendor/Readability.js`: vendored upstream parser source.
- `licenses/`: third-party license text and attribution notes.

## Loading the Extension

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this repository root.

The popup opens the reader shell on the active tab when page extraction succeeds.

## Contributing

Contributions are welcome. Please open an issue or pull request to discuss ideas, report bugs, or suggest improvements.

## License

This project is licensed under the MIT License. See `LICENSE`.

### Third-Party Components

- Readability.js (Apache-2.0) for article content extraction.

Third-party attribution lives in `licenses/THIRD_PARTY_NOTICES.md`, and the vendored Readability license text is preserved in `licenses/Readability-LICENSE.md`.
