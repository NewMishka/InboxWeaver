export const DEFAULT_SETTINGS = Object.freeze({
  basePath: 'Вложения',
  selectedAccounts: [],
  liveMode: true,
  forceNoDuplicates: true,
  showAuditButton: false,
  showResetMenu: false,
  stopAfterFirstMatch: false,
  enableTags: true,
  enableNotifications: true,
  autoReportEnabled: false,
  autoReportIntervalMinutes: 1440
});

export async function getRules(storage = messenger.storage.local) {
  const { rules = [] } = await storage.get({ rules: [] });
  return rules.filter(rule => rule && rule.enabled !== false);
}

export async function getSettings(storage = messenger.storage.local) {
  const { settings = {} } = await storage.get({ settings: {} });
  return {
    ...DEFAULT_SETTINGS,
    ...(settings && typeof settings === 'object' ? settings : {}),
    selectedAccounts: Array.isArray(settings?.selectedAccounts)
      ? settings.selectedAccounts.map(String)
      : []
  };
}
