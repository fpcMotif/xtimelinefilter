/**
 * The extension's cross-context wire contract. This is the only public
 * protocol entry point; each private file owns one complete wire domain.
 */

export {
  isClearDataRequest,
  isContentToBackgroundMessage,
  isPopupToContentMessage,
  PAGE_ACTIVATE_CHANNEL,
  PAGE_ACTIVATE_READY,
  PAGE_ACTIVATE_REQUEST,
  PAGE_ACTIVATE_RESPONSE,
  PAGE_ACTIVATE_TARGET,
  requestLassoDataClear,
  sendToBackground,
  sendToTab,
  type ActivateRequest,
  type BadgeMessage,
  type ClearDataRequest,
  type ClearDataResponse,
  type ContentToBackground,
  type LassoStatusResponse,
  type PopupToContent,
  type StateMessage,
  type StatusRequest,
} from "./protocol/tab";
export {
  decodeSettingsPatch,
  encodeSettingsPatch,
  isSettingsRequest,
  requestSettingsPatch,
  requestSettingsRead,
  type SettingsRequest,
  type SettingsResponse,
  type SettingsWirePatch,
} from "./protocol/settings";
export {
  isFilterRequest,
  requestFilterCommand,
  requestFilterRead,
  type FilterRequest,
  type FilterResponse,
} from "./protocol/filter";
export {
  isCoachRequest,
  requestCoach,
  type CoachRequest,
  type CoachResponse,
} from "./protocol/coach";
export {
  isListCacheRequest,
  requestListCache,
  type ListCacheRequest,
  type ListCacheResponse,
  type ListCacheSuccess,
} from "./protocol/list-cache";
export {
  isListUsageRequest,
  requestListUsage,
  type ListUsageRequest,
  type ListUsageResponse,
  type ListUsageSuccess,
} from "./protocol/list-usage";
export {
  isMirrorStatusRequest,
  requestMirrorStatus,
  type MirrorStatusRequest,
  type MirrorStatusResponse,
  type MirrorStatusSuccess,
} from "./protocol/mirror-status";
export {
  isGraphqlCatalogRequest,
  requestGraphqlCatalog,
  type GraphqlCatalogRequest,
  type GraphqlCatalogResponse,
  type GraphqlCatalogSuccess,
} from "./protocol/graphql-catalog";
export { isStorageChangedMessage, type StorageChangedMessage } from "./protocol/storage-events";
