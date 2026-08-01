import type { AppState } from "@/content/app-state";
import type { LassoController } from "@/content/controller";
import type { FolderPickerController } from "@/core/folder-picker-controller";
import type { ToastStore } from "@/core/toast-store";
import { FolderPicker } from "@/ui/FolderPicker";
import { UI_LAYER } from "@/ui/layers";
import { ToastHost } from "@/ui/Toast";
import { useSignalValue } from "@/ui/use-signal-value";

export interface NonXSurfaceProps {
  app: AppState;
  folderPicker: FolderPickerController;
  controller: LassoController;
  toasts: ToastStore;
}

export function NonXSurface({ app, folderPicker, controller, toasts }: NonXSurfaceProps) {
  const open = useSignalValue(app.folderPickerOpen);
  return (
    <>
      {open && (
        <>
          <div
            aria-hidden="true"
            data-folder-picker-backdrop
            class="fixed inset-0 bg-transparent"
            style={{ zIndex: UI_LAYER.modal }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              folderPicker.act({ type: "close" });
              app.folderPickerOpen.value = false;
            }}
          />
          <div
            data-folder-picker-panel
            class="fixed"
            style={{
              zIndex: UI_LAYER.modal,
              bottom: "88px",
              left: "50%",
              transform: "translateX(-50%)",
            }}
          >
            <FolderPicker
              picker={folderPicker}
              onEffect={(effect) => void controller.folderPickerEffect(effect)}
              onCancel={() => {
                app.folderPickerOpen.value = false;
              }}
            />
          </div>
        </>
      )}
      <ToastHost store={toasts} />
    </>
  );
}
