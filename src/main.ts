import { copy } from 'fs-extra'
import { mkdir } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { App, FileSystemAdapter, Plugin } from 'obsidian'

interface PluginManifest {
  id: string
  dir: string
}

interface PluginCollection {
  manifests: Record<string, PluginManifest>
  enabledPlugins: Set<string>
  disablePlugin(plugin: string): Promise<void>
  enablePlugin(plugin: string): Promise<void>
}

interface GlobalApp extends App {
  plugins: PluginCollection
}

interface PluginFileConfig {
  source: string
  destination: string
}

interface PluginConfig {
  id: string
  files: (string | PluginFileConfig)[] | null | undefined
}

interface Config {
  reloadButtonIcon: string | null | undefined
  plugins: PluginConfig[] | null | undefined
}

const SOURCE_MAP_PROPERTY_NAME = 'debug-plugin'

export default class PluginUpdateButton extends Plugin {
  async onload() {
    const config: Config = await this.loadData()
    this.app.workspace.onLayoutReady(() => {
      const adapter = this.app.vault.adapter
      if (adapter instanceof FileSystemAdapter) {
        this.addRibbonIcon(config.reloadButtonIcon || 'refresh-ccw', 'Update Workspace Plugins', () => {
          this.updatePlugins(this.app as GlobalApp, adapter.getBasePath(), this.app.vault.configDir).catch(console.error)
        })
      }
    })
  }

  private async updatePlugins(app: GlobalApp, vaultPath: string, configDir: string) {
    const { plugins: pluginConfigs }: Config = await this.loadData()
    for (const manifest of Object.values(app.plugins.manifests)) {
      const pluginConfig = (pluginConfigs || []).find(({ id }) => id === manifest.id)
      if (pluginConfig) {
        const pluginPath = join(vaultPath, configDir, parse(manifest.dir).base)
        console.log(`Updating files for ${manifest.id}`)
        try {
          for (const file of pluginConfig.files || []) {
            const sourcePath = typeof file === 'string' ? file : file.source
            const destinationPath = typeof file === 'string'
              ? join(pluginPath, parse(file).base)
              : file.destination
            console.log(`Copying ${sourcePath} to ${destinationPath}`)
            await copy(sourcePath, destinationPath)
          }
          await this.reloadPlugin(app.plugins, manifest.id)
        } catch (error) {
          console.error(error)
        }
      }
    }
  }

  /**
   * This function is derived from the one in the official(?) Hot Reload plugin.
   * The original code is Copyright 2023 PJ Eby and is available here:
   * https://github.com/pjeby/hot-reload/blob/fe57f9ea63c49b78ea0d0d426b68abf39d539016/main.js#L89
   */
  private async reloadPlugin(plugins: PluginCollection, pluginName: string) {
    if (!plugins.enabledPlugins.has(pluginName)) {
      return
    }
    await plugins.disablePlugin(pluginName)
    console.log(`Disabled ${pluginName}`)
    /* Load sourcemaps in Obsidian 14+ */
    const oldDebug = localStorage.getItem(SOURCE_MAP_PROPERTY_NAME)
    localStorage.setItem(SOURCE_MAP_PROPERTY_NAME, '1')
    try {
      await plugins.enablePlugin(pluginName)
    } finally {
      /* Restore previous setting */
      if (oldDebug === null) {
        localStorage.removeItem(SOURCE_MAP_PROPERTY_NAME)
      } else {
        localStorage.setItem(SOURCE_MAP_PROPERTY_NAME, oldDebug)
      }
    }
    console.log(`Enabled ${pluginName}`)
  }
}