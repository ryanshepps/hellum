import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useActiveAssistantId } from "@/assistant/use-active-assistant-id";
import { useTranslation } from "@/i18n";
import { getGlobalThresholds, setGlobalThresholds } from "@/lib/threshold-api";
import {
  THRESHOLD_PRESETS,
  presetFromThreshold,
  type ThresholdPreset,
} from "@/utils/threshold-presets";
import { Card } from "@vellumai/design-library/components/card";
import { Disclosure } from "@vellumai/design-library/components/disclosure";
import { Select } from "@vellumai/design-library/components/select";

const CONVERSATION_PRESETS = THRESHOLD_PRESETS.filter(
  (p) => p.id !== "conservative",
);
const UNATTENDED_PRESETS = THRESHOLD_PRESETS.filter(
  (p) => p.id === "strict" || p.id === "fullAccess",
);

function Divider() {
  return (
    <div className="h-px bg-[var(--surface-active)] dark:bg-[var(--surface-lift)]" />
  );
}

export function RiskToleranceSettings() {
  const { t } = useTranslation("settings");
  const assistantId = useActiveAssistantId();

  const toOption = useCallback(
    (p: ThresholdPreset) => ({
      value: p.id,
      label: t(p.labelKey, p.label),
      icon: <p.icon className="h-3.5 w-3.5" />,
    }),
    [t],
  );
  const conversationOptions = useMemo(
    () => CONVERSATION_PRESETS.map(toOption),
    [toOption],
  );
  const unattendedOptions = useMemo(
    () => UNATTENDED_PRESETS.map(toOption),
    [toOption],
  );
  const presetDescription = (id: string): string => {
    switch (id) {
      case "strict":
        return t("riskToleranceSettings.strictDescription");
      case "relaxed":
        return t("riskToleranceSettings.relaxedDescription");
      default:
        return t("riskToleranceSettings.fullAccessDescription");
    }
  };

  const queryClient = useQueryClient();
  const { data: thresholds, isError: loadError } = useQuery({
    queryKey: ["thresholds", assistantId],
    queryFn: () => getGlobalThresholds(assistantId),
    staleTime: 30_000,
  });

  const [interactivePresetId, setInteractivePresetId] =
    useState<string>("relaxed");
  const [autonomousPresetId, setAutonomousPresetId] =
    useState<string>("strict");
  const [headlessPresetId, setHeadlessPresetId] = useState<string>("strict");

  const hasUserInteracted = useRef(false);
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFlushRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!thresholds || hasUserInteracted.current) {
      return;
    }
    setInteractivePresetId(presetFromThreshold(thresholds.interactive).id);
    setAutonomousPresetId(presetFromThreshold(thresholds.autonomous).id);
    setHeadlessPresetId(presetFromThreshold(thresholds.headless).id);
    setHasLoadedInitial(true);
  }, [thresholds]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        pendingFlushRef.current?.();
        pendingFlushRef.current = null;
      }
    };
  }, []);

  const persistThresholds = useCallback(
    (interactiveId: string, autonomousId: string, headlessId: string) => {
      if (!assistantId || !hasLoadedInitial) {
        return;
      }
      const interactive = THRESHOLD_PRESETS.find(
        (p) => p.id === interactiveId,
      )?.riskThreshold;
      const autonomous = THRESHOLD_PRESETS.find(
        (p) => p.id === autonomousId,
      )?.riskThreshold;
      const headless = THRESHOLD_PRESETS.find(
        (p) => p.id === headlessId,
      )?.riskThreshold;
      if (!interactive || !autonomous || !headless) {
        return;
      }
      setGlobalThresholds(assistantId, { interactive, autonomous, headless })
        .then(() => {
          queryClient.invalidateQueries({
            queryKey: ["thresholds", assistantId],
          });
        })
        .catch(() => {
          // Silent — optimistic update stays; user can retry by changing again
        });
    },
    [assistantId, hasLoadedInitial, queryClient],
  );

  const scheduleSave = useCallback(
    (interactiveId: string, autonomousId: string, headlessId: string) => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      pendingFlushRef.current = () =>
        persistThresholds(interactiveId, autonomousId, headlessId);
      saveTimerRef.current = setTimeout(() => {
        pendingFlushRef.current?.();
        saveTimerRef.current = null;
        pendingFlushRef.current = null;
      }, 500);
    },
    [persistThresholds],
  );

  const handleInteractiveChange = useCallback(
    (presetId: string) => {
      hasUserInteracted.current = true;
      setInteractivePresetId(presetId);
      scheduleSave(presetId, autonomousPresetId, headlessPresetId);
    },
    [autonomousPresetId, headlessPresetId, scheduleSave],
  );

  const handleAutonomousChange = useCallback(
    (presetId: string) => {
      hasUserInteracted.current = true;
      setAutonomousPresetId(presetId);
      scheduleSave(interactivePresetId, presetId, headlessPresetId);
    },
    [interactivePresetId, headlessPresetId, scheduleSave],
  );

  const handleHeadlessChange = useCallback(
    (presetId: string) => {
      hasUserInteracted.current = true;
      setHeadlessPresetId(presetId);
      scheduleSave(interactivePresetId, autonomousPresetId, presetId);
    },
    [interactivePresetId, autonomousPresetId, scheduleSave],
  );

  const interactivePreset = THRESHOLD_PRESETS.find(
    (p) => p.id === interactivePresetId,
  );
  const autonomousPreset = THRESHOLD_PRESETS.find(
    (p) => p.id === autonomousPresetId,
  );
  const headlessPreset = THRESHOLD_PRESETS.find(
    (p) => p.id === headlessPresetId,
  );
  const dropdownsDisabled = !assistantId || !hasLoadedInitial;

  return (
    <Card>
      <h2 className="text-title-medium text-[var(--content-default)]">
        {t("riskToleranceSettings.title")}
      </h2>
      <p className="mt-1 text-body-medium-lighter text-[var(--content-tertiary)]">
        {t("riskToleranceSettings.description")}
      </p>
      {loadError && (
        <p className="mt-2 text-body-small-lighter text-[var(--system-negative-strong)]">
          {t("riskToleranceSettings.loadError")}
        </p>
      )}
      <div className="mt-4 space-y-4">
        <div>
          <div className="text-body-medium-default text-[var(--content-default)]">
            {t("riskToleranceSettings.conversationsTitle")}
          </div>
          <p className="mt-0.5 text-body-small-lighter text-[var(--content-tertiary)]">
            {t("riskToleranceSettings.conversationsDescription")}
          </p>
          <div className="mt-2" style={{ maxWidth: 280 }}>
            <Select
              value={interactivePresetId}
              onChange={handleInteractiveChange}
              options={conversationOptions}
              disabled={dropdownsDisabled}
            />
          </div>
          {interactivePreset && (
            <p className="mt-2 text-body-small-default text-[var(--content-tertiary)]">
              {presetDescription(interactivePreset.id)}
            </p>
          )}
        </div>

        <Divider />

        <Disclosure.Root>
          <Disclosure.Trigger size="medium">
            {t("riskToleranceSettings.advanced")}
          </Disclosure.Trigger>

          <Disclosure.Content keepMounted className="mt-4 space-y-4">
            <div>
              <div className="text-body-medium-default text-[var(--content-default)]">
                {t("riskToleranceSettings.backgroundTitle")}
              </div>
              <p className="mt-0.5 text-body-small-lighter text-[var(--content-tertiary)]">
                {t("riskToleranceSettings.backgroundDescription")}
              </p>
              <div className="mt-2" style={{ maxWidth: 280 }}>
                <Select
                  value={autonomousPresetId}
                  onChange={handleAutonomousChange}
                  options={unattendedOptions}
                  disabled={dropdownsDisabled}
                />
              </div>
              {autonomousPreset && (
                <p className="mt-2 text-body-small-default text-[var(--content-tertiary)]">
                  {presetDescription(autonomousPreset.id)}
                </p>
              )}
            </div>

            <Divider />

            <div>
              <div className="text-body-medium-default text-[var(--content-default)]">
                {t("riskToleranceSettings.headlessTitle")}
              </div>
              <p className="mt-0.5 text-body-small-lighter text-[var(--content-tertiary)]">
                {t("riskToleranceSettings.headlessDescription")}
              </p>
              <div className="mt-2" style={{ maxWidth: 280 }}>
                <Select
                  value={headlessPresetId}
                  onChange={handleHeadlessChange}
                  options={unattendedOptions}
                  disabled={dropdownsDisabled}
                />
              </div>
              {headlessPreset && (
                <p className="mt-2 text-body-small-default text-[var(--content-tertiary)]">
                  {presetDescription(headlessPreset.id)}
                </p>
              )}
            </div>
          </Disclosure.Content>
        </Disclosure.Root>
      </div>
    </Card>
  );
}
