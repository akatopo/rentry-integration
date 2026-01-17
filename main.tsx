// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from './h.js';

import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingGroup,
  Notice,
} from 'obsidian';

import {
  updateRentry,
  deleteRentry,
  createRentry,
  purgeLeftoverEmbeds,
} from './commands.js';
import { rentryPropNames } from './frontmatter-props.js';
import { CommandNotice } from './CommandNotice.js';
import { StatusBarSpinner } from './StatusBarSpinner.js';
import {
  ConfirmationModal,
  type ConfirmationModalRes,
} from './ConfirmationModal.js';

import type { ButtonsRenderFunc } from './ConfirmationModal.js';

interface RentryIntegrationPluginSettings {
  includeFrontmatter: boolean;
  skipEmptyFrontmatterValues: boolean;
  replaceEmbeds: boolean;
  cloudinaryCloudName?: string;
  cloudinaryApiKey?: string;
  cloudinaryApiSecret?: string;
}

const DEFAULT_SETTINGS: RentryIntegrationPluginSettings = {
  includeFrontmatter: false,
  skipEmptyFrontmatterValues: true,
  replaceEmbeds: false,
};

export default class RentryIntegrationPlugin extends Plugin {
  settings: RentryIntegrationPluginSettings;
  statusBarItem: ReturnType<Plugin['addStatusBarItem']>;

  async onload() {
    await this.loadSettings();

    [updateRentry, deleteRentry, createRentry, purgeLeftoverEmbeds].forEach(
      (createCommand) => {
        this.addCommand(createCommand(this));
      },
    );

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new SettingTab(this.app, this));

    this.statusBarItem = this.addStatusBarItem();
  }

  onunload() {}

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  notice(message: string, rentryUrl?: string) {
    new Notice(<CommandNotice {...{ message, rentryUrl }} />);
  }

  noticeError(message: string) {
    new Notice(<CommandNotice {...{ message, variant: 'error' }} />);
  }

  confirmationModal({
    title,
    content,
    buttons,
  }: {
    content: () => DocumentFragment;
    buttons: ButtonsRenderFunc;
    title: string;
  }): Promise<ConfirmationModalRes | undefined> {
    const { app } = this;
    return new Promise((resolve, _reject) => {
      let modalRes: ConfirmationModalRes | undefined;
      const modal = new ConfirmationModal(app, {
        title,
        content,
        buttons,
        onSubmit: (res) => {
          modalRes = res;
          modal.close();
        },
      });
      modal.setCloseCallback(() => {
        resolve(modalRes);
      });
      modal.open();
    });
  }

  renderStatusBarSpinner(label: string) {
    const { statusBarItem } = this;
    const clear = () => {
      statusBarItem.empty();
    };
    clear();
    statusBarItem.append(<StatusBarSpinner {...{ label }} />);

    return clear;
  }
}

class SettingTab extends PluginSettingTab {
  plugin: RentryIntegrationPlugin;

  constructor(app: App, plugin: RentryIntegrationPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl, plugin } = this;
    const { settings } = plugin;

    containerEl.empty();
    containerEl.addClass('plugin-rentry-integration');

    const [head, ...rest] = rentryPropNames.toSorted().reverse();

    const desc = (
      <>
        Include frontmatter as a markdown table in rentry pastes.
        <br />
        Will <em>not</em> include{' '}
        {rest.reverse().map((r) => (
          <>
            <code>{r}</code>
            {', '}
          </>
        ))}
        and <code>{head}</code> properties.
      </>
    );

    let skipEmptyFrontmatterSetting: Setting | undefined = undefined;

    const mainSettingGroup = new SettingGroup(containerEl);

    mainSettingGroup
      .addSetting((s) =>
        s
          .setName('Include frontmatter')
          .setDesc(desc)
          .addToggle((toggle) => {
            toggle
              .setValue(settings.includeFrontmatter)
              .onChange(async (value) => {
                settings.includeFrontmatter = value;
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                skipEmptyFrontmatterSetting!.setDisabled(!value);

                await plugin.saveSettings();
              });
          }),
      )
      .addSetting((s) => {
        skipEmptyFrontmatterSetting = s;
        s.setName('Skip empty frontmatter values')
          .setDesc(
            'Do not include frontmatter values that are empty in the rentry paste.',
          )
          .addToggle((toggle) => {
            toggle
              .setValue(settings.skipEmptyFrontmatterValues)
              .onChange(async (value) => {
                settings.skipEmptyFrontmatterValues = value;
                await plugin.saveSettings();
              });
          })
          .setDisabled(!settings.includeFrontmatter);
      });

    const cloudinarySettings: Setting[] = [];
    const embedSettingGroup = new SettingGroup(containerEl);

    const setupCloudinarySetting =
      (
        name: string,
        settingName:
          | 'cloudinaryCloudName'
          | 'cloudinaryApiKey'
          | 'cloudinaryApiSecret',
      ) =>
      (s: Setting) => {
        cloudinarySettings.push(s);
        s.setName(name)
          .addText((t) => {
            if (settingName === 'cloudinaryApiSecret') {
              t.inputEl.type = 'password';
            }
            t.setValue(settings[settingName] ?? '').onChange(async (v) => {
              settings[settingName] = v;
              await plugin.saveSettings();
            });
          })
          .setDisabled(!settings.replaceEmbeds);
      };

    embedSettingGroup
      .setHeading(
        <>
          Embeds{' '}
          <sup>
            <em>experimental</em>
          </sup>
        </>,
      )
      .addSetting((s) =>
        s.setName('Enable embed uploads').addToggle((toggle) => {
          toggle.setValue(settings.replaceEmbeds).onChange(async (value) => {
            settings.replaceEmbeds = value;
            cloudinarySettings.forEach((setting) =>
              setting.setDisabled(!value),
            );
            await plugin.saveSettings();
          });
        }),
      )
      .addSetting(
        setupCloudinarySetting('Cloudinary cloud name', 'cloudinaryCloudName'),
      )
      .addSetting(
        setupCloudinarySetting('Cloudinary API key', 'cloudinaryApiKey'),
      )
      .addSetting(
        setupCloudinarySetting('Cloudinary API secret', 'cloudinaryApiSecret'),
      );
  }
}
