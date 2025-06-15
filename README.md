# Directus Video Sizes Hook

A Custom API Hook extension for Directus CMS to add width and height metadata to videos in the File Library.

Unlike images, videos get no width and height attributes on upload. This extension adds them, automatically or manually with tags, to they can be served with video assets for use on the front-end.

## Requirements

Requires Directus to be running in an environment with `ffmpeg` installed, and for the user Directus runs as to have permissions to run it. Specifically, the extension uses `ffprobe`, which is part of of a standard `ffmpeg` installation.

## Installation

1. Download repo.
2. Run `npm build` to compile.
3. Move the entire repo folder into the `/extensions` directory of your Directus installation.
4. Restart Directus.

Check the hook is running under Settings > Extensions. It should show under the Hooks heading as enabled. If not, you probably need to install `ffmpeg` and make it available to the user Directus runs under.

## Usage

### Auto-dimensions

Polls locally-stored videos every 10 seconds for new videos, and automatically detects and adds dimensions.

### Manual dimensions via tag

For CDN hosted videos, dimensions can’t be auto-detected. Add a tag to the video asset in File Library in the format `reprocess:widthxheight` where width and height are integers, e.g. `reprocess:1920x1080`. The hook will add the width and height you specify.

You can add manual tags to locally-hosted videos, if needed.

### Reprocessing

If you want to flag a locally-hosted video to have its dimensions re-calculated, add the tag `reprocess`. The width and height will be auto-calculated on the next run.
