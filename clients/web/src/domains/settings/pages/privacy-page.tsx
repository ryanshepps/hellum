import { SystemPermissionsCard } from "@/components/system-permissions-card";
import { BiometricSettingsCard } from "@/domains/settings/components/biometric-settings-card";
import { MediaEmbedsCard } from "@/domains/settings/components/media-embeds-card";
import { RiskToleranceSettings } from "@/domains/settings/components/risk-tolerance-settings";

export function PrivacyPage() {
  return (
    <div className="space-y-4">
      <BiometricSettingsCard />
      <SystemPermissionsCard />
      <RiskToleranceSettings />
      <MediaEmbedsCard />
    </div>
  );
}
