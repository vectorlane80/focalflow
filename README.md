# FocalFlow

FocalFlow is a Chrome extension focused on extraction-first reading. Phase 2 establishes the minimal architecture for clean article parsing and a reader-mode shell, leaving RSVP playback for a later phase.

## Current Phase

- Extract the active page into article data using Mozilla Readability.
- Open a full-screen reader shell populated from extracted headings and paragraphs.
- Keep permissions narrow: only `activeTab` and `scripting`.
- Avoid copying implementation code from the reference import during this phase.

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
