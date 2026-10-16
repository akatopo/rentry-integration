# Rentry integration

[Rentry](https://rentry.co) integration plugin for [Obsidian](https://obsidian.md).

https://github.com/user-attachments/assets/0f929724-8d32-4eda-aef1-c622cfc19cb6

## Features

- Paste creation.
- Paste updating (one-way sync towards Rentry) and removal.
- Image embed uploads via Cloudinary (_experimental_, requires credentials. See Cloudinary's [Developer kickstart](https://cloudinary.com/documentation/dev_kickstart) for further instructions).

## Usage

Can either be used via the command palette (<kbd>⌘</kbd> + <kbd>P</kbd> / <kbd>Ctrl</kbd> + <kbd>P</kbd>):

![](img/palette.png)

or the file context menu:

![](img/menu.png)

## Frontmatter properties

The following frontmatter properties are created and used by the plugin for all Rentry (and Cloudinary) related actions:

| Property           | Description                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `rentryId`         | The Rentry id of the uploaded paste.                                                                                           |
| `rentryUrl`        | The public Rentry URL of the uploaded paste                                                                                    |
| `rentryEditCode`   | Edit code for directly editing the paste on the Rentry website.                                                                |
| `rentryEmbedCache` | Cache for mapping embed paths to Cloudinary URLs and other data. Only used when the "Enable embed uploads" setting is enabled. |

## Rentry metadata

While using [Rentry metadata](https://rentry.co/metadata-how) is not supported by the plugin, the following default metadata is used when creating pastes:

```ini
OPTION_DISABLE_SEARCH_ENGINE=true
OPTION_DISABLE_VIEWS=true
```

Additionally, the plugin uses Rentry's upsert update mode for metadata when updating the paste. This means that whatever changes to the metadata you make on Rentry are going to persist between updates.
