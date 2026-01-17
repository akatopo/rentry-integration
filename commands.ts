import { MarkdownView } from 'obsidian';
import { source } from 'common-tags';

import * as rentryApi from './rentry.js';

import {
  Buttons as DeleteModalButtons,
  Content as DeleteModalContent,
} from './DeletePasteModalSlots.js';
import {
  Content as PurgeEmbedsModalContent,
  Buttons as PurgeEmbedsModalButtons,
} from './PurgeEmbedsModalSlots.js';
import {
  tryGetFrontmatterCopy,
  cachedRead,
  promiseSettled,
  tryProcessFrontmatter,
} from './util.js';
import { tryParseEmbedCache, syncEmbeds, purgeEmbeds } from './embeds.js';
import {
  tryRenderFrontmatterText,
  removeEmptyPropsFromFrontmatterObject,
  removeRentryPropsFromFrontmatterObject,
  replaceResolvedEmbeds,
  removeFrontmatterFromText,
  removeEmbedCacheFromFrontmatterObject,
} from './transforms.js';

import type { TFile, App, Plugin } from 'obsidian';
import type RentryIntegrationPlugin from './main.js';
import type { RentryEmbedCache, ResolvedEmbed } from './embeds.js';

export const updateRentry = (plugin: RentryIntegrationPlugin) => ({
  id: 'update-rentry',
  name: 'Update paste',
  checkCallback: (checking: boolean) =>
    editRentryCheckCallback(checking, plugin, (props) => {
      if (!props) {
        return;
      }

      const { rentryEditCode, rentryId, rentryUrl, rentryEmbedCache, file } =
        props;
      const { app, settings } = plugin;
      const {
        includeFrontmatter,
        skipEmptyFrontmatterValues,
        replaceEmbeds,
        cloudinaryApiKey,
        cloudinaryApiSecret,
        cloudinaryCloudName,
      } = settings;

      const clearSpinner = plugin.renderStatusBarSpinner('Updating paste');

      trySyncEmbeds(
        {
          replaceEmbeds,
          rentryEmbedCache,
          cloudinaryApiKey,
          cloudinaryApiSecret,
          cloudinaryCloudName,
        },
        file,
        app,
      ).then((res) => {
        const [newRentryEmbedCache, resolvedEmbeds] = res;

        handleSyncEmbedsRes(res, plugin);

        return getTextForRentry(
          {
            includeFrontmatter,
            skipEmptyFrontmatterValues,
            replaceEmbeds,
            embedCache: newRentryEmbedCache,
            resolvedEmbeds,
          },
          file,
          app,
        )
          .then((text) => {
            return rentryApi.update({
              id: rentryId,
              editCode: rentryEditCode,
              text,
            });
          })
          .then(() => {
            plugin.notice('Paste updated', rentryUrl);
          })
          .catch((reason) => tryNoticeError(plugin, reason))
          .finally(() => {
            clearSpinner();

            // embed cache should be written regardless of rentry call success
            // and should mutate frontmatter after being done with text transforms
            if (newRentryEmbedCache) {
              return tryProcessFrontmatter(
                (fm) => {
                  fm.rentryEmbedCache = JSON.stringify(newRentryEmbedCache);
                },
                file,
                app,
              );
            }
          });
      });
    }),
});

export const purgeLeftoverEmbeds = (plugin: RentryIntegrationPlugin) => ({
  id: 'purge-embeds',
  name: 'Purge leftover embeds',
  checkCallback: (checking: boolean) =>
    purgeEmbedsCheckCallback(checking, plugin, (props) => {
      if (!props) {
        return;
      }

      const { app, settings } = plugin;
      const { rentryEmbedCache, file } = props;

      const {
        replaceEmbeds,
        cloudinaryApiKey,
        cloudinaryApiSecret,
        cloudinaryCloudName,
      } = settings;

      plugin
        .confirmationModal({
          title: 'Purge leftover embeds',
          content: () => PurgeEmbedsModalContent({ filename: file.name }),
          buttons: PurgeEmbedsModalButtons,
        })
        .then((res) => {
          if (res !== 'confirm') {
            return;
          }

          const clearSpinner = plugin.renderStatusBarSpinner('Deleting embeds');

          promiseSettled(
            tryPurgeEmbeds(
              {
                replaceEmbeds,
                rentryEmbedCache,
                cloudinaryApiKey,
                cloudinaryApiSecret,
                cloudinaryCloudName,
              },
              file,
              app,
            ),
          )
            .then((res) => handlePurgeEmbedsSettledRes(res, plugin))
            .finally(() => clearSpinner());
        });
    }),
});

export const deleteRentry = (plugin: RentryIntegrationPlugin) => ({
  id: 'delete-rentry',
  name: 'Delete paste',
  checkCallback: (checking: boolean) =>
    editRentryCheckCallback(checking, plugin, (props) => {
      if (!props) {
        return;
      }

      const { app, settings } = plugin;
      const { rentryEditCode, rentryId, rentryEmbedCache, file } = props;

      const {
        replaceEmbeds,
        cloudinaryApiKey,
        cloudinaryApiSecret,
        cloudinaryCloudName,
      } = settings;

      plugin
        .confirmationModal({
          title: 'Delete paste',
          content: () => DeleteModalContent({ filename: file.name }),
          buttons: DeleteModalButtons,
        })
        .then((res) => {
          if (res !== 'confirm') {
            return;
          }

          const clearSpinner = plugin.renderStatusBarSpinner('Deleting paste');

          const embedsPurged = tryPurgeEmbeds(
            {
              replaceEmbeds,
              rentryEmbedCache,
              cloudinaryApiKey,
              cloudinaryApiSecret,
              cloudinaryCloudName,
            },
            file,
            app,
          );

          const pasteRemoved = rentryApi
            .remove({ id: rentryId, editCode: rentryEditCode })
            .then(() => {
              // embedCache prop should be removed independent of rentry props
              return tryProcessFrontmatter(
                (fm) => {
                  removeRentryPropsFromFrontmatterObject(fm, true);
                },
                file,
                app,
              );
            });

          Promise.allSettled([embedsPurged, pasteRemoved])
            .then((results) => {
              const [embedsPurgedRes, pasteRemovedRes] = results;
              handlePurgeEmbedsSettledRes(embedsPurgedRes, plugin);

              if (pasteRemovedRes.status === 'fulfilled') {
                plugin.notice('Paste deleted');
              } else {
                tryNoticeError(plugin, pasteRemovedRes.reason);
              }
            })
            .finally(() => {
              clearSpinner();
            });
        });
    }),
});

export const createRentry = (plugin: RentryIntegrationPlugin) => ({
  id: 'create-rentry',
  name: 'Create paste',
  checkCallback: (checking: boolean) =>
    createRentryCheckCallback(checking, plugin, ({ file }) => {
      if (!file) {
        return;
      }
      const { app, settings } = plugin;
      const {
        replaceEmbeds,
        cloudinaryApiKey,
        cloudinaryApiSecret,
        cloudinaryCloudName,
        includeFrontmatter,
        skipEmptyFrontmatterValues,
      } = settings;

      const clearSpinner = plugin.renderStatusBarSpinner('Creating paste');

      // no embed cache should be used, maybe should try purging if a cache exists
      trySyncEmbeds(
        {
          replaceEmbeds,
          cloudinaryApiKey,
          cloudinaryApiSecret,
          cloudinaryCloudName,
        },
        file,
        app,
      ).then((res) => {
        const [newRentryEmbedCache, resolvedEmbeds] = res;

        handleSyncEmbedsRes(res, plugin);

        return getTextForRentry(
          {
            skipEmptyFrontmatterValues,
            includeFrontmatter,
            replaceEmbeds,
            resolvedEmbeds,
            embedCache: newRentryEmbedCache,
          },
          file,
          app,
        )
          .then((rentryText) =>
            rentryApi
              .create({ text: rentryText })
              .then(({ id, url, editCode }) => {
                return tryProcessFrontmatter(
                  (fm) => {
                    fm.rentryId = id;
                    fm.rentryUrl = url;
                    fm.rentryEditCode = editCode;
                  },
                  file,
                  app,
                ).then(() => ({ id, url, editCode }));
              }),
          )
          .then((res) => {
            plugin.notice('Paste created', res?.url);
          })
          .catch((reason) => tryNoticeError(plugin, reason))
          .finally(() => {
            clearSpinner();

            // embed cache should be written regardless of rentry call success
            // and should mutate frontmatter after being done with text transforms
            if (newRentryEmbedCache) {
              return tryProcessFrontmatter(
                (fm) => {
                  fm.rentryEmbedCache = JSON.stringify(newRentryEmbedCache);
                },
                file,
                app,
              );
            }
          });
      });
    }),
});

function tryNoticeError(plugin: RentryIntegrationPlugin, reason: unknown) {
  if (!Error.isError(reason)) {
    return;
  }

  const message = String(reason?.message);
  const cause = Error.isError(reason?.cause)
    ? String(reason.cause.message)
    : '';
  plugin.noticeError(`${message}${cause ? `: ${cause}` : ''}`);
}

function purgeEmbedsCheckCallback(
  checking: boolean,
  plugin: Plugin,
  fn: (props: ReturnType<typeof hasOnlyEmbedCacheFrontmatterProp>[1]) => void,
) {
  const { app } = plugin;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  const [hasProps, props] = hasOnlyEmbedCacheFrontmatterProp(markdownView, app);
  const shouldDisplayCommand = !!markdownView && hasProps;

  if (checking && shouldDisplayCommand) {
    return true;
  }
  if (!shouldDisplayCommand) {
    return;
  }
  return fn(props);
}

function editRentryCheckCallback(
  checking: boolean,
  plugin: Plugin,
  fn: (props: ReturnType<typeof hasRentryFrontmatterProps>[1]) => void,
) {
  const { app } = plugin;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  const [hasProps, props] = hasRentryFrontmatterProps(markdownView, app);
  const shouldDisplayCommand = !!markdownView && hasProps;

  if (checking && shouldDisplayCommand) {
    return true;
  }
  if (!shouldDisplayCommand) {
    return;
  }
  return fn(props);
}

function createRentryCheckCallback(
  checking: boolean,
  plugin: Plugin,
  fn: ({ file }: { file?: TFile }) => void,
) {
  const { app } = plugin;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  const [hasProps] = hasRentryFrontmatterProps(markdownView, app);
  const shouldDisplayCommand = !!markdownView && !hasProps;

  if (checking && shouldDisplayCommand) {
    return true;
  }
  if (!shouldDisplayCommand) {
    return;
  }
  return fn({ file: markdownView?.file ?? undefined });
}

function hasOnlyEmbedCacheFrontmatterProp(
  markdownView: MarkdownView | null,
  app: App,
) {
  const checkFailed = [false, undefined] as const;
  if (!markdownView) {
    return checkFailed;
  }
  const { file } = markdownView;
  if (!file) {
    return checkFailed;
  }

  const { frontmatter } = app.metadataCache.getFileCache(file) ?? {};
  const { rentryId, rentryEditCode, rentryUrl, rentryEmbedCache } =
    frontmatter ?? {};

  if (rentryEmbedCache && !rentryId) {
    return [
      true,
      {
        rentryEditCode: rentryEditCode ? String(rentryEditCode) : undefined,
        rentryId: undefined,
        rentryUrl: rentryUrl ? String(rentryUrl) : undefined,
        rentryEmbedCache: tryParseEmbedCache(rentryEmbedCache),
        file,
      },
    ] as const;
  }
  return checkFailed;
}

function hasRentryFrontmatterProps(
  markdownView: MarkdownView | null,
  app: App,
) {
  const checkFailed = [false, undefined] as const;
  if (!markdownView) {
    return checkFailed;
  }
  const { file } = markdownView;
  if (!file) {
    return checkFailed;
  }

  const { frontmatter } = app.metadataCache.getFileCache(file) ?? {};
  const { rentryId, rentryEditCode, rentryUrl, rentryEmbedCache } =
    frontmatter ?? {};

  if (rentryId && rentryEditCode) {
    return [
      true,
      {
        rentryEditCode: String(rentryEditCode),
        rentryId: String(rentryId),
        rentryUrl: String(rentryUrl),
        rentryEmbedCache: tryParseEmbedCache(rentryEmbedCache),
        file,
      },
    ] as const;
  }
  return checkFailed;
}

async function getTextForRentry(
  {
    includeFrontmatter,
    skipEmptyFrontmatterValues,
    replaceEmbeds,
    resolvedEmbeds,
    embedCache,
  }: {
    includeFrontmatter: boolean;
    skipEmptyFrontmatterValues: boolean;
    replaceEmbeds: boolean;
    resolvedEmbeds?: ResolvedEmbed[];
    embedCache?: RentryEmbedCache;
  },
  file: TFile,
  app: App,
) {
  const [frontmatterText, textWithoutFrontmatter] = await Promise.all([
    includeFrontmatter
      ? applyFrontmatterTransforms(skipEmptyFrontmatterValues, file, app)
      : Promise.resolve(''),
    applyTextTransforms(
      { replaceEmbeds, resolvedEmbeds, embedCache },
      file,
      app,
    ),
  ]);

  return source`
    ${frontmatterText}

    ${textWithoutFrontmatter}
  `;
}

async function applyTextTransforms(
  {
    replaceEmbeds,
    resolvedEmbeds,
    embedCache,
  }: {
    replaceEmbeds: boolean;
    resolvedEmbeds?: ResolvedEmbed[];
    embedCache?: RentryEmbedCache;
  },
  file: TFile,
  app: App,
) {
  let text = await cachedRead(file, app);
  if (replaceEmbeds && resolvedEmbeds && embedCache) {
    text = await replaceResolvedEmbeds(resolvedEmbeds, embedCache, text);
  }

  return removeFrontmatterFromText(text, file, app);
}

async function applyFrontmatterTransforms(
  skipEmptyFrontmatterValues: boolean,
  file: TFile,
  app: App,
) {
  const fm = await tryGetFrontmatterCopy(file, app);
  removeRentryPropsFromFrontmatterObject(fm);
  if (skipEmptyFrontmatterValues) {
    removeEmptyPropsFromFrontmatterObject(fm);
  }

  return tryRenderFrontmatterText(fm);
}

function trySyncEmbeds(
  {
    replaceEmbeds,
    rentryEmbedCache,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    cloudinaryCloudName,
  }: {
    replaceEmbeds: boolean;
    rentryEmbedCache?: RentryEmbedCache;
    cloudinaryApiKey?: string;
    cloudinaryApiSecret?: string;
    cloudinaryCloudName?: string;
  },
  file: TFile,
  app: App,
) {
  return (
    replaceEmbeds &&
    cloudinaryApiKey &&
    cloudinaryApiSecret &&
    cloudinaryCloudName
      ? syncEmbeds(
          {
            rentryEmbedCache,
            cloudinaryApiKey,
            cloudinaryApiSecret,
            cloudinaryCloudName,
          },
          file,
          app,
        )
      : Promise.resolve([undefined, undefined, true] as const)
  ).catch(() => {
    return [undefined, undefined, true] as const;
  });
}

function handleSyncEmbedsRes(
  res: Awaited<ReturnType<typeof trySyncEmbeds>>,
  plugin: RentryIntegrationPlugin,
) {
  const [newRentryEmbedCache, , hasRejections] = res;
  if (hasRejections) {
    tryNoticeError(
      plugin,
      new Error(
        !newRentryEmbedCache
          ? 'Failed to sync embeds'
          : 'Could not sync some embeds',
      ),
    );
  }
}

function tryPurgeEmbeds(
  {
    replaceEmbeds,
    rentryEmbedCache,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    cloudinaryCloudName,
  }: {
    replaceEmbeds: boolean;
    rentryEmbedCache?: RentryEmbedCache;
    cloudinaryApiKey?: string;
    cloudinaryApiSecret?: string;
    cloudinaryCloudName?: string;
  },
  file: TFile,
  app: App,
) {
  return (
    replaceEmbeds &&
    cloudinaryApiKey &&
    cloudinaryApiSecret &&
    cloudinaryCloudName
      ? purgeEmbeds(
          {
            rentryEmbedCache,
            cloudinaryApiKey,
            cloudinaryApiSecret,
            cloudinaryCloudName,
          },
          file,
          app,
        )
      : Promise.resolve([false, undefined] as const)
  )
    .catch(() => {
      return [false, undefined] as const;
    })
    .then(([safeToRemoveCache, newRentryEmbedCache]) => {
      let action;

      if (safeToRemoveCache) {
        // only remove the embed cache

        action = tryProcessFrontmatter(
          (fm) => {
            removeEmbedCacheFromFrontmatterObject(fm);
          },
          file,
          app,
        );
      } else if (newRentryEmbedCache) {
        // update embed cache with leftover unpurged assets

        action = tryProcessFrontmatter(
          (fm) => {
            fm.rentryEmbedCache = JSON.stringify(newRentryEmbedCache);
          },
          file,
          app,
        );
      }

      return (action ?? Promise.resolve()).then(
        () => [safeToRemoveCache, newRentryEmbedCache] as const,
      );
    });
}

function handlePurgeEmbedsSettledRes(
  embedsPurgedRes: PromiseSettledResult<
    Awaited<ReturnType<typeof tryPurgeEmbeds>>
  >,
  plugin: RentryIntegrationPlugin,
) {
  if (embedsPurgedRes.status === 'fulfilled') {
    const [safeToRemoveCache] = embedsPurgedRes.value ?? [];
    if (!safeToRemoveCache) {
      tryNoticeError(
        plugin,
        new Error('Not all embeds were purged successfully'),
      );
    }
  } else {
    tryNoticeError(plugin, embedsPurgedRes.reason);
  }
}
