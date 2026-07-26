import { transitionSettings, type LassoSettings, type SettingsPatch } from "@/core/settings-domain";
import type { StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";

type MigrationState = "pending" | "complete" | "cleared";

const migrationState = (value: unknown): MigrationState | null =>
  value === "pending" || value === "complete" || value === "cleared" ? value : null;

async function remove(area: StorageLike, key: string): Promise<void> {
  if (area.remove) await area.remove(key);
  else await area.set({ [key]: undefined });
}

/** Owns legacy settings migration and the local settings authority. */
export function createSettingsAuthority(
  local: StorageLike,
  sync: StorageLike,
  createMirrorConfigId: () => string,
) {
  /** One persisted, retry-safe migration. `cleared` is terminal. */
  const migrate = async (): Promise<boolean> => {
    try {
      const state = migrationState(
        (await local.get(STORAGE_KEYS.settingsMigration))[STORAGE_KEYS.settingsMigration],
      );
      if (state === "complete" || state === "cleared") return true;

      await local.set({ [STORAGE_KEYS.settingsMigration]: "pending" });
      const localSettings = (await local.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings];
      const legacySettings = (await sync.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings];
      if (localSettings === undefined && legacySettings !== undefined) {
        await local.set({ [STORAGE_KEYS.settings]: legacySettings });
      }
      if (legacySettings !== undefined) await remove(sync, STORAGE_KEYS.settings);
      await local.set({ [STORAGE_KEYS.settingsMigration]: "complete" });
      return true;
    } catch {
      return false;
    }
  };

  const ready = async (): Promise<void> => {
    if (!(await migrate())) throw new Error("Settings migration is unavailable");
  };

  const read = async (): Promise<LassoSettings> => {
    await ready();
    const raw = (await local.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings];
    const transition = transitionSettings(raw, createMirrorConfigId);
    if (transition.changed) await local.set({ [STORAGE_KEYS.settings]: transition.stored });
    return transition.settings;
  };

  const patch = async (next: SettingsPatch): Promise<LassoSettings> => {
    await ready();
    const raw = (await local.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings];
    const transition = transitionSettings(raw, createMirrorConfigId, next);
    if (transition.changed) await local.set({ [STORAGE_KEYS.settings]: transition.stored });
    return transition.settings;
  };

  return { migrate, read, patch };
}
