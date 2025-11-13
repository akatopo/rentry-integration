import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

import {
  updateRentry,
  deleteRentry,
  createRentry,
  rentryPropNames,
} from './commands.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from './h.js';

// Remember to rename these classes and interfaces!

interface PluginSettings {
  mySetting: string;
  includeFrontmatter: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
  mySetting: 'default',
  includeFrontmatter: false,
};

export default class RentryIntegrationPlugin extends Plugin {
  settings: PluginSettings;

  async onload() {
    await this.loadSettings();

    [updateRentry, deleteRentry, createRentry].forEach((createCommand) => {
      this.addCommand(createCommand(this));
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new SettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
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

    const [head, ...rest] = rentryPropNames;
    const desc = (
      <>
        Include frontmatter as a markdown table in rentry pastes. Will{' '}
        <strong>not</strong> include{' '}
        {rest.map((r) => (
          <>
            <code>{r}</code>
            {', '}
          </>
        ))}
        and <code>{head}</code> properties.
      </>
    );

    new Setting(containerEl)
      .setName('Include frontmatter')
      .setDesc(desc)
      .addToggle((toggle) => {
        toggle.setValue(settings.includeFrontmatter).onChange(async (value) => {
          settings.includeFrontmatter = value;
          await plugin.saveSettings();
        });
      });
  }
}
