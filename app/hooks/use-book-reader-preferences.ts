import { useCallback, useEffect, useState } from "react";
import type { DockviewPanelApi } from "dockview-react";
import type { PanelTypographyParams } from "~/components/workspace-book-reader";
import type { SuccessorRenditionAdapter } from "~/lib/epub/successor-reader-adapter";
import type { FontWeight, ReaderLayout, Settings, TextAlign } from "~/lib/settings";
import {
  getBookPreferences,
  saveBookPreferences,
  type BookPreferences,
} from "~/lib/stores/book-preferences-store";

interface UseBookReaderPreferencesOptions {
  bookId: string;
  panelApi?: DockviewPanelApi;
  panelTypography?: PanelTypographyParams;
  settings: Settings;
  renditionRef: React.RefObject<SuccessorRenditionAdapter | null>;
  navigationRef: React.MutableRefObject<{
    markNavigationInProgress: () => void;
    navigationInProgressRef: React.MutableRefObject<boolean>;
  } | null>;
}

export function useBookReaderPreferences({
  bookId,
  panelApi,
  panelTypography,
  settings,
  renditionRef,
  navigationRef,
}: UseBookReaderPreferencesOptions) {
  const [fontFamily, setFontFamily] = useState(
    () => panelTypography?.fontFamily ?? settings.fontFamily,
  );
  const [fontSize, setFontSize] = useState(() => panelTypography?.fontSize ?? settings.fontSize);
  const [fontWeight, setFontWeight] = useState<FontWeight>(
    () => panelTypography?.fontWeight ?? settings.fontWeight,
  );
  const [lineHeight, setLineHeight] = useState(
    () => panelTypography?.lineHeight ?? settings.lineHeight,
  );
  const [textAlign, setTextAlign] = useState<TextAlign>(
    () => panelTypography?.textAlign ?? settings.textAlign,
  );
  const [readerLayout, setReaderLayout] = useState<ReaderLayout>(
    () => panelTypography?.readerLayout ?? settings.readerLayout,
  );

  useEffect(() => {
    let cancelled = false;

    getBookPreferences(bookId)
      .then((preferences) => {
        if (cancelled) return;
        setFontFamily(
          preferences?.fontFamily ?? panelTypography?.fontFamily ?? settings.fontFamily,
        );
        setFontSize(preferences?.fontSize ?? panelTypography?.fontSize ?? settings.fontSize);
        setFontWeight(
          preferences?.fontWeight ?? panelTypography?.fontWeight ?? settings.fontWeight,
        );
        setLineHeight(
          preferences?.lineHeight ?? panelTypography?.lineHeight ?? settings.lineHeight,
        );
        setTextAlign(
          preferences && "textAlign" in preferences
            ? preferences.textAlign
            : (panelTypography?.textAlign ?? settings.textAlign),
        );
        setReaderLayout(
          preferences?.readerLayout ?? panelTypography?.readerLayout ?? settings.readerLayout,
        );
      })
      .catch((error) => console.error("Failed to load book preferences:", error));

    return () => {
      cancelled = true;
    };
  }, [
    bookId,
    panelTypography?.fontFamily,
    panelTypography?.fontSize,
    panelTypography?.fontWeight,
    panelTypography?.lineHeight,
    panelTypography?.readerLayout,
    panelTypography?.textAlign,
    settings.fontFamily,
    settings.fontSize,
    settings.fontWeight,
    settings.lineHeight,
    settings.readerLayout,
    settings.textAlign,
  ]);

  const onUpdateSettings = useCallback(
    (update: Partial<Settings>) => {
      const hasBookPreferenceUpdate =
        update.fontFamily !== undefined ||
        update.fontSize !== undefined ||
        update.fontWeight !== undefined ||
        update.lineHeight !== undefined ||
        "textAlign" in update ||
        update.readerLayout !== undefined;

      if (!hasBookPreferenceUpdate) return;

      if (update.fontFamily !== undefined) setFontFamily(update.fontFamily);
      if (update.fontSize !== undefined) setFontSize(update.fontSize);
      if (update.fontWeight !== undefined) setFontWeight(update.fontWeight);
      if (update.lineHeight !== undefined) setLineHeight(update.lineHeight);
      if ("textAlign" in update) setTextAlign(update.textAlign);
      if (update.readerLayout !== undefined && update.readerLayout !== readerLayout) {
        const cfi = renditionRef.current?.location?.start?.cfi;
        setReaderLayout(update.readerLayout);
        if (cfi) {
          navigationRef.current?.markNavigationInProgress();
          queueMicrotask(() => {
            renditionRef.current?.display(cfi).catch((error: unknown) => {
              console.error("Failed to restore reader position after layout update", error);
              if (navigationRef.current) {
                navigationRef.current.navigationInProgressRef.current = false;
              }
            });
          });
        }
      }

      const updatedPreferences: BookPreferences = {
        fontFamily: update.fontFamily ?? fontFamily,
        fontSize: update.fontSize ?? fontSize,
        fontWeight: update.fontWeight ?? fontWeight,
        lineHeight: update.lineHeight ?? lineHeight,
        textAlign: "textAlign" in update ? update.textAlign : textAlign,
        readerLayout: update.readerLayout ?? readerLayout,
      };

      saveBookPreferences(bookId, updatedPreferences).catch((error) =>
        console.error("Failed to save book preferences:", error),
      );

      if (panelApi) {
        const parameterUpdates: Record<string, unknown> = {};
        if (update.fontFamily !== undefined) parameterUpdates.fontFamily = update.fontFamily;
        if (update.fontSize !== undefined) parameterUpdates.fontSize = update.fontSize;
        if (update.fontWeight !== undefined) parameterUpdates.fontWeight = update.fontWeight;
        if (update.lineHeight !== undefined) parameterUpdates.lineHeight = update.lineHeight;
        if (update.textAlign !== undefined) parameterUpdates.textAlign = update.textAlign;
        if (update.readerLayout !== undefined) parameterUpdates.readerLayout = update.readerLayout;
        if (Object.keys(parameterUpdates).length > 0) panelApi.updateParameters(parameterUpdates);
      }
    },
    [
      bookId,
      fontFamily,
      fontSize,
      fontWeight,
      lineHeight,
      navigationRef,
      panelApi,
      readerLayout,
      renditionRef,
      textAlign,
    ],
  );

  const localSettings: Settings = {
    ...settings,
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    textAlign,
    readerLayout,
  };

  return {
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    textAlign,
    readerLayout,
    localSettings,
    onUpdateSettings,
  };
}
