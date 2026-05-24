const HOME = process.env.HOME ?? "";
const DATA = `${HOME}/.quartermaster`;
const CLAUDE = `${HOME}/.claude`;

export const paths = {
  dataDir: DATA,
  inventoryDb: `${DATA}/inventory.db`,
  inventoryHash: `${DATA}/inventory.hash`,
  trustJson: `${DATA}/trust.json`,
  cliExtras: `${DATA}/cli-extras.json`,
  synonyms: `${DATA}/synonyms.json`,
  sessionMarker: `${DATA}/.init-nudge-shown`,
  logDir: `${DATA}/logs`,
  claudeDir: CLAUDE,
  claudeSkills: `${CLAUDE}/skills`,
  claudeCommands: `${CLAUDE}/commands`,
  claudeAgents: `${CLAUDE}/agents`,
  claudePluginsManifest: `${CLAUDE}/plugins/installed_plugins.json`,
  claudeSettings: `${CLAUDE}/settings.json`,
  claudeJson: `${HOME}/.claude.json`,
} as const;
