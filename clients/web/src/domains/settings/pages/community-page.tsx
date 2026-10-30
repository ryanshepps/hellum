import {
  ArrowUpRight,
  Bug,
  ExternalLink,
  GitPullRequest,
  Play,
  Star,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { ExternalAnchor } from "@/components/external-anchor";
import { GitHubLogo } from "@/components/icons/github-logo";
import { useTranslation } from "@/i18n";
import {
  HELLUM_REPO_URL,
  HERMES_REPO_URL,
  VELLUM_REPO_URL,
} from "@/utils/external-urls";
import { Button } from "@vellumai/design-library/components/button";
import { Card } from "@vellumai/design-library/components/card";
import { Tag } from "@vellumai/design-library/components/tag";

type SettingsTranslate = ReturnType<typeof useTranslation<"settings">>["t"];

function HeroBanner({ t }: { t: SettingsTranslate }) {
  return (
    <Card padding="lg" className="bg-[var(--surface-lift)]">
      <div className="relative">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--system-mid-weak) 0%, transparent 70%)",
          }}
          aria-hidden
        />
        <div className="relative flex flex-col items-start gap-3">
          <Tag tone="neutral">
            <Play className="h-3.5 w-3.5" />
            {t("communityPage.heroTag")}
          </Tag>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-[var(--content-emphasised)]">
            {t("communityPage.heroTitle")}
          </h1>
          <p className="max-w-xl text-body-medium-default text-[color:var(--content-tertiary)]">
            {t("communityPage.heroDescription")}
          </p>
        </div>
      </div>
    </Card>
  );
}

interface BenefitRowProps {
  icon: ComponentType<{
    size?: number;
    className?: string;
    "aria-hidden"?: boolean;
  }>;
  text: string;
}

function BenefitRow({ icon: Icon, text }: BenefitRowProps) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-base)]">
        <Icon
          size={14}
          className="text-[var(--content-secondary)]"
          aria-hidden
        />
      </span>
      <span className="text-body-medium-lighter text-[color:var(--content-secondary)]">
        {text}
      </span>
    </li>
  );
}

interface FeatureCardProps {
  accentColor: string;
  iconColor?: string;
  label: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  benefits: ReadonlyArray<BenefitRowProps>;
  primaryAction: { label: string; icon: ReactNode; onClick: () => void };
  secondaryAction?: { label: string; href: string };
}

function FeatureCard({
  accentColor,
  iconColor = "var(--aux-white)",
  label,
  icon,
  title,
  subtitle,
  benefits,
  primaryAction,
  secondaryAction,
}: FeatureCardProps) {
  return (
    <Card padding="lg" className="flex-1">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <span
            className="flex size-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: accentColor, color: iconColor }}
          >
            {icon}
          </span>
          <span className="text-label-medium-default uppercase tracking-wider text-[color:var(--content-tertiary)]">
            {label}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <h2 className="text-title-medium text-[var(--content-emphasised)]">
            {title}
          </h2>
          <p className="text-body-medium-lighter text-[color:var(--content-tertiary)]">
            {subtitle}
          </p>
        </div>

        <ul className="flex flex-col gap-3">
          {benefits.map(({ icon: BenefitIcon, text }) => (
            <BenefitRow key={text} icon={BenefitIcon} text={text} />
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Button onClick={primaryAction.onClick}>
            {primaryAction.icon}
            {primaryAction.label}
          </Button>
          {secondaryAction && (
            <Button
              variant="ghost"
              onClick={() =>
                window.open(
                  secondaryAction.href,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              {secondaryAction.label}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

interface ResourceCardProps {
  icon: ReactNode;
  iconBg: string;
  iconColor?: string;
  title: string;
  description: string;
  href: string;
}

function ResourceCard({
  icon,
  iconBg,
  iconColor = "white",
  title,
  description,
  href,
}: ResourceCardProps) {
  return (
    <ExternalAnchor
      href={href}
      className="flex flex-1 cursor-pointer"
      glyph={false}
    >
      <Card className="flex-1 transition-shadow hover:shadow-md" padding="lg">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between">
            <span
              className="flex size-10 items-center justify-center rounded-lg"
              style={{ backgroundColor: iconBg, color: iconColor }}
            >
              {icon}
            </span>
            <ExternalLink
              size={14}
              className="text-[var(--content-tertiary)]"
              aria-hidden
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-title-medium text-[var(--content-emphasised)]">
              {title}
            </span>
            <p className="text-body-medium-lighter text-[color:var(--content-tertiary)]">
              {description}
            </p>
          </div>
        </div>
      </Card>
    </ExternalAnchor>
  );
}

export function CommunityPage() {
  const { t } = useTranslation("settings");

  return (
    <div className="space-y-6">
      <HeroBanner t={t} />

      <FeatureCard
        accentColor="var(--content-emphasised)"
        iconColor="var(--surface-base)"
        label={t("communityPage.openSourceLabel")}
        icon={<GitHubLogo size={20} />}
        title={t("communityPage.openSourceTitle")}
        subtitle={t("communityPage.openSourceSubtitle")}
        benefits={[
          {
            icon: Star,
            text: t("communityPage.openSourceBenefitStar"),
          },
          {
            icon: Bug,
            text: t("communityPage.openSourceBenefitIssues"),
          },
          {
            icon: GitPullRequest,
            text: t("communityPage.openSourceBenefitContribute"),
          },
        ]}
        primaryAction={{
          label: t("communityPage.starOnGitHub"),
          icon: <Star size={16} />,
          onClick: () =>
            window.open(HELLUM_REPO_URL, "_blank", "noopener,noreferrer"),
        }}
        secondaryAction={{
          label: t("communityPage.openIssue"),
          href: `${HELLUM_REPO_URL}/issues`,
        }}
      />

      <div className="flex flex-col gap-4">
        <h2 className="text-label-medium-default uppercase tracking-wider text-[color:var(--content-tertiary)]">
          {t("communityPage.builtOn")}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ResourceCard
            icon={<GitHubLogo size={20} />}
            iconBg="var(--content-default)"
            iconColor="var(--surface-base)"
            title={t("communityPage.vellumTitle")}
            description={t("communityPage.vellumDescription")}
            href={VELLUM_REPO_URL}
          />
          <ResourceCard
            icon={<GitHubLogo size={20} />}
            iconBg="var(--content-default)"
            iconColor="var(--surface-base)"
            title={t("communityPage.hermesTitle")}
            description={t("communityPage.hermesDescription")}
            href={HERMES_REPO_URL}
          />
        </div>
      </div>
    </div>
  );
}
