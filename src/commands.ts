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

import type { TFile, App, Menu } from 'obsidian';
import type RentryIntegrationPlugin from './main.js';
import type { RentryEmbedCache, ResolvedEmbed } from './embeds.js';

const commandInfo = [
  {
    id: 'update-rentry',
    name: 'Update paste',
    createCheckCallback:
      (plugin: RentryIntegrationPlugin) => (checking: boolean) =>
        editRentryCheckCallback(checking, plugin, updateRentryFromProps),
    createMenuItemRenderer:
      (title: string, plugin: RentryIntegrationPlugin) =>
      (menu: Menu, file: TFile) => {
        const { app } = plugin;
        const [canUpdateRentry, updateProps] = fileHasRentryFrontmatterProps(
          file,
          app,
        );

        if (!canUpdateRentry) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle(title)
            .onClick(() => updateRentryFromProps(updateProps, plugin));
        });
      },
  },
  {
    id: 'purge-embeds',
    name: 'Purge leftover embeds',
    createCheckCallback:
      (plugin: RentryIntegrationPlugin) => (checking: boolean) =>
        purgeEmbedsCheckCallback(checking, plugin, purgeEmbedsFromProps),
    createMenuItemRenderer:
      (title: string, plugin: RentryIntegrationPlugin) =>
      (menu: Menu, file: TFile) => {
        const { app } = plugin;
        const [canPurgeEmbedCache, embedCacheProps] =
          fileHasOnlyPopulatedEmbedCacheFrontmatterProp(file, app);

        if (!canPurgeEmbedCache) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle(title)
            .onClick(() => purgeEmbedsFromProps(embedCacheProps, plugin));
        });
      },
  },
  {
    id: 'delete-rentry',
    name: 'Delete paste',
    createCheckCallback:
      (plugin: RentryIntegrationPlugin) => (checking: boolean) =>
        editRentryCheckCallback(checking, plugin, deleteRentryFromProps),
    createMenuItemRenderer:
      (title: string, plugin: RentryIntegrationPlugin) =>
      (menu: Menu, file: TFile) => {
        const { app } = plugin;
        const [canUpdateRentry, updateProps] = fileHasRentryFrontmatterProps(
          file,
          app,
        );

        if (!canUpdateRentry) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle(title)
            .onClick(() => deleteRentryFromProps(updateProps, plugin));
        });
      },
  },
  {
    id: 'create-rentry',
    name: 'Create paste',
    createCheckCallback:
      (plugin: RentryIntegrationPlugin) => (checking: boolean) =>
        createRentryCheckCallback(checking, plugin, createRentryFromFile),
    createMenuItemRenderer:
      (title: string, plugin: RentryIntegrationPlugin) =>
      (menu: Menu, file: TFile) => {
        const { app } = plugin;
        const [canUpdateRentry] = fileHasRentryFrontmatterProps(file, app);

        if (canUpdateRentry) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle(title)
            .onClick(() => createRentryFromFile({ file }, plugin));
        });
      },
  },
] as const;

export const commands = commandInfo.map(
  ({ id, name, createCheckCallback }) =>
    (plugin: RentryIntegrationPlugin) => ({
      checkCallback: createCheckCallback(plugin),
      id,
      name,
    }),
);

export const menuItems = commandInfo.map(
  ({ name: title, createMenuItemRenderer }) =>
    (plugin: RentryIntegrationPlugin) =>
      createMenuItemRenderer(title, plugin),
);

export async function updateRentryFromProps(
  props: ReturnType<typeof viewHasRentryFrontmatterProps>[1],
  plugin: RentryIntegrationPlugin,
) {
  if (!props) {
    return;
  }

  const { rentryEditCode, rentryId, rentryUrl, rentryEmbedCache, file } = props;
  const { app, settings } = plugin;
  const {
    includeFrontmatter,
    skipEmptyFrontmatterValues,
    replaceEmbeds,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    cloudinaryCloudName,
    useRentryDotOrg,
  } = settings;

  const clearSpinner = plugin.renderStatusBarSpinner('Updating paste');

  let newRentryEmbedCache: RentryEmbedCache | undefined;
  let resolvedEmbeds: ResolvedEmbed[] | undefined;
  if (replaceEmbeds) {
    const res = await trySyncEmbeds(
      {
        rentryEmbedCache,
        cloudinaryApiKey,
        cloudinaryApiSecret,
        cloudinaryCloudName,
      },
      file,
      app,
    );

    [newRentryEmbedCache, resolvedEmbeds] = res;

    handleSyncEmbedsRes(res, plugin);
  }

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
        useRentryDotOrg,
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
}

export function purgeEmbedsFromProps(
  props: ReturnType<typeof viewHasOnlyPopulatedEmbedCacheFrontmatterProp>[1],
  plugin: RentryIntegrationPlugin,
) {
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
        .then((res) => handlePurgeEmbedsSettledRes(res, file, plugin))
        .finally(() => clearSpinner());
    });
}

export function deleteRentryFromProps(
  props: ReturnType<typeof viewHasRentryFrontmatterProps>[1],
  plugin: RentryIntegrationPlugin,
) {
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
    useRentryDotOrg,
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

      const embedsPurged = replaceEmbeds
        ? tryPurgeEmbeds(
            {
              rentryEmbedCache,
              cloudinaryApiKey,
              cloudinaryApiSecret,
              cloudinaryCloudName,
            },
            file,
            app,
          )
        : Promise.resolve(undefined);

      const pasteRemoved = rentryApi.remove({
        id: rentryId,
        editCode: rentryEditCode,
        useRentryDotOrg,
      });

      Promise.allSettled([embedsPurged, pasteRemoved])
        .then(async (results) => {
          const [embedsPurgedRes, pasteRemovedRes] = results;
          if (replaceEmbeds) {
            // @ts-expect-error
            await handlePurgeEmbedsSettledRes(embedsPurgedRes, file, plugin);
          }

          if (pasteRemovedRes.status === 'fulfilled') {
            plugin.notice('Paste deleted');
            // embedCache prop should be removed independent of rentry props
            await tryProcessFrontmatter(
              (fm) => {
                removeRentryPropsFromFrontmatterObject(fm, true);
              },
              file,
              app,
            );
          } else {
            tryNoticeError(plugin, pasteRemovedRes.reason);
          }
        })
        .finally(() => {
          clearSpinner();
        });
    });
}

export async function createRentryFromFile(
  { file }: { file?: TFile },
  plugin: RentryIntegrationPlugin,
) {
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
    useRentryDotOrg,
  } = settings;

  const clearSpinner = plugin.renderStatusBarSpinner('Creating paste');

  let newRentryEmbedCache: RentryEmbedCache | undefined;
  let resolvedEmbeds: ResolvedEmbed[] | undefined;
  if (replaceEmbeds) {
    // no embed cache should be used, maybe should try purging if a cache exists
    const res = await trySyncEmbeds(
      {
        cloudinaryApiKey,
        cloudinaryApiSecret,
        cloudinaryCloudName,
      },
      file,
      app,
    );

    [newRentryEmbedCache, resolvedEmbeds] = res;

    handleSyncEmbedsRes(res, plugin);
  }

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
        .create({ text: rentryText, useRentryDotOrg })
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
}

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
  plugin: RentryIntegrationPlugin,
  fn: (
    props: ReturnType<typeof viewHasOnlyPopulatedEmbedCacheFrontmatterProp>[1],
    plugin: RentryIntegrationPlugin,
  ) => void,
) {
  const { app } = plugin;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  const [hasProps, props] = viewHasOnlyPopulatedEmbedCacheFrontmatterProp(
    markdownView,
    app,
  );
  const shouldDisplayCommand = !!markdownView && hasProps;

  if (checking && shouldDisplayCommand) {
    return true;
  }
  if (!shouldDisplayCommand) {
    return;
  }
  return fn(props, plugin);
}

function editRentryCheckCallback(
  checking: boolean,
  plugin: RentryIntegrationPlugin,
  fn: (
    props: ReturnType<typeof viewHasRentryFrontmatterProps>[1],
    plugin: RentryIntegrationPlugin,
  ) => void,
) {
  const { app } = plugin;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  const [hasProps, props] = viewHasRentryFrontmatterProps(markdownView, app);
  const shouldDisplayCommand = !!markdownView && hasProps;

  if (checking && shouldDisplayCommand) {
    return true;
  }
  if (!shouldDisplayCommand) {
    return;
  }
  return fn(props, plugin);
}

function createRentryCheckCallback(
  checking: boolean,
  plugin: RentryIntegrationPlugin,
  fn: ({ file }: { file?: TFile }, plugin: RentryIntegrationPlugin) => void,
) {
  const { app } = plugin;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  const [hasProps] = viewHasRentryFrontmatterProps(markdownView, app);
  const shouldDisplayCommand = !!markdownView && !hasProps;

  if (checking && shouldDisplayCommand) {
    return true;
  }
  if (!shouldDisplayCommand) {
    return;
  }
  return fn({ file: markdownView?.file ?? undefined }, plugin);
}

function viewHasOnlyPopulatedEmbedCacheFrontmatterProp(
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
  return fileHasOnlyPopulatedEmbedCacheFrontmatterProp(file, app);
}

export function fileHasOnlyPopulatedEmbedCacheFrontmatterProp(
  file: TFile,
  app: App,
) {
  const checkFailed = [false, undefined] as const;
  if (!file) {
    return checkFailed;
  }

  const { frontmatter } = app.metadataCache.getFileCache(file) ?? {};
  const { rentryId, rentryEditCode, rentryUrl, rentryEmbedCache } =
    frontmatter ?? {};

  if (rentryEmbedCache && !rentryId) {
    const parsed = tryParseEmbedCache(rentryEmbedCache);

    if (!Object.keys(parsed?.pathMap ?? {}).length) {
      return checkFailed;
    }
    return [
      true,
      {
        rentryEditCode: rentryEditCode ? String(rentryEditCode) : undefined,
        rentryId: undefined,
        rentryUrl: rentryUrl ? String(rentryUrl) : undefined,
        rentryEmbedCache: parsed,
        file,
      },
    ] as const;
  }
  return checkFailed;
}

function viewHasRentryFrontmatterProps(
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

  return fileHasRentryFrontmatterProps(file, app);
}

export function fileHasRentryFrontmatterProps(file: TFile, app: App) {
  const checkFailed = [false, undefined] as const;
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
    rentryEmbedCache,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    cloudinaryCloudName,
  }: {
    rentryEmbedCache?: RentryEmbedCache;
    cloudinaryApiKey?: string;
    cloudinaryApiSecret?: string;
    cloudinaryCloudName?: string;
  },
  file: TFile,
  app: App,
) {
  const failed = [undefined, undefined, true] as const;

  return (
    cloudinaryApiKey && cloudinaryApiSecret && cloudinaryCloudName
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
      : Promise.resolve(failed)
  ).catch(() => failed);
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
    rentryEmbedCache,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    cloudinaryCloudName,
  }: {
    rentryEmbedCache?: RentryEmbedCache;
    cloudinaryApiKey?: string;
    cloudinaryApiSecret?: string;
    cloudinaryCloudName?: string;
  },
  file: TFile,
  app: App,
) {
  return (
    cloudinaryApiKey && cloudinaryApiSecret && cloudinaryCloudName
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

async function handlePurgeEmbedsSettledRes(
  embedsPurgedRes: PromiseSettledResult<
    Awaited<ReturnType<typeof tryPurgeEmbeds>>
  >,
  file: TFile,
  plugin: RentryIntegrationPlugin,
) {
  const { app } = plugin;
  if (embedsPurgedRes.status === 'fulfilled') {
    const [safeToRemoveCache, newRentryEmbedCache] =
      embedsPurgedRes.value ?? [];
    if (!safeToRemoveCache) {
      tryNoticeError(
        plugin,
        new Error('Not all embeds were purged successfully'),
      );
    }
    if (safeToRemoveCache) {
      // only remove the embed cache

      await tryProcessFrontmatter(
        (fm) => {
          removeEmbedCacheFromFrontmatterObject(fm);
        },
        file,
        app,
      );
    } else if (newRentryEmbedCache) {
      // update embed cache with leftover unpurged assets

      await tryProcessFrontmatter(
        (fm) => {
          fm.rentryEmbedCache = JSON.stringify(newRentryEmbedCache);
        },
        file,
        app,
      );
    }
  } else {
    tryNoticeError(plugin, embedsPurgedRes.reason);
  }
}
