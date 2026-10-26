# Hellum

Hellum is an iPhone app for the [Hermes agent](https://github.com/nousresearch/hermes-agent), built on [Vellum](https://github.com/vellum-ai/vellum-assistant)'s open-source web and iOS clients.

A small **bridge** runs on your Mac next to Hermes. It serves the Vellum web UI, speaks Vellum's assistant API to it, and translates every call into Hermes' JSON-RPC gateway. The iOS app is Vellum's Capacitor shell, rebranded and pointed at your bridge.

```
iPhone (Hellum app) ──https──▶ tailscale serve ──▶ bridge (Bun) ──WebSocket JSON-RPC──▶ Hermes gateway
                                                      └──HTTP/2──▶ Apple Push Notification service
```

## What works

- Chat with Hermes: streaming replies, reasoning, tool calls, and stop.
- Tool approvals: approve or deny risky commands from the phone.
- All Hermes sessions, including Telegram and CLI ones, in the sidebar. Rename, archive, and delete.
- Push notifications when a reply finishes, an approval is needed, or a turn fails.
- Pairing by QR code, with revocable per-device sessions.

Not yet supported: attachments, memory, schedules, skills, documents, voice, and Vellum's interactive cards (`ui_surface_*` events).

## Repository layout

| Path | What it is |
| --- | --- |
| `bridge/` | The Hellum bridge: HTTP API, SSE, pairing, Hermes client, APNs. |
| `clients/web/` | Vellum's web client, in self-hosted mode with the Vellum platform disabled. |
| `clients/ios/` | Vellum's Capacitor iOS shell, rebranded as Hellum. |
| `packages/`, `assistant/src/api/` | Vellum packages the web client builds against. |

## Set up the bridge on your Mac

### 1. Prerequisites

- [Hermes](https://github.com/nousresearch/hermes-agent) installed at `~/.hermes/hermes-agent` with a working model provider.
- [Bun](https://bun.sh) 1.3 or newer.
- [Tailscale](https://tailscale.com) on the Mac and the iPhone.

### 2. Build

```sh
bun install
(cd clients/web && bun run build)
```

### 3. Configure

Create `~/.hellum/.env`. Every setting is optional:

```sh
HELLUM_PORT=7870
HELLUM_ASSISTANT_NAME=Hellum
# Push notifications. Create an APNs auth key under Certificates, Identifiers & Profiles > Keys.
HELLUM_APNS_KEY_PATH=/Users/you/.hellum/AuthKey_ABCDEFGHIJ.p8
HELLUM_APNS_KEY_ID=ABCDEFGHIJ
HELLUM_APNS_TEAM_ID=YOURTEAMID
```

Keep the `.p8` key outside the repository. Git ignores `*.p8` as a backstop.

### 4. Run it at login

```sh
bun run bridge/scripts/install-launch-agent.ts
```

The launch agent is named `<bundle ID>.bridge`, using `HELLUM_BUNDLE_ID` from `clients/ios/App/App/Config/Local.xcconfig` (see [Build the iOS app](#build-the-ios-app-for-testflight)), or `com.example.hellum.bridge` without one. Logs go to `~/.hellum/bridge.log`. To run it in the foreground instead: `cd ~/.hellum && bun run ~/path/to/hellum/bridge/src/main.ts`.

### 5. Expose it to your tailnet

```sh
tailscale serve --bg --https=4443 http://127.0.0.1:7870
```

Your bridge address is then `https://<your-mac>.<tailnet>.ts.net:4443`. It is only reachable from devices on your tailnet.

## Pair a device

```sh
alias hellum="bun run ~/path/to/hellum/bridge/src/cli.ts"
hellum pair https://<your-mac>.<tailnet>.ts.net:4443
```

Scan the QR code with the iPhone camera. The Hellum app opens, confirms the server, and pairs in one step.

Other commands:

| Command | Does |
| --- | --- |
| `hellum pending` | Lists pairing requests started from a device. |
| `hellum approve ABCD-EFGH` | Approves a code shown on a device. |
| `hellum devices` | Lists paired devices. |
| `hellum revoke <device-id>` | Unpairs a device and ends its sessions. |

`hellum` talks to the bridge over `~/.hellum/admin.sock`, a socket only your user can open, so pairing can never be approved from the network.

## Build the iOS app for TestFlight

1. Set your team and bundle ID. Create `clients/ios/App/App/Config/Local.xcconfig` (gitignored):

   ```
   DEVELOPMENT_TEAM = YOURTEAMID
   HELLUM_BUNDLE_ID = com.yourname.hellum
   ```

   Every target derives its identifiers from `HELLUM_BUNDLE_ID`, and the Capacitor config and the bridge's launch agent read it from this file too.

2. Generate the project and open it:

   ```sh
   (cd clients/web && bun run ios:setup)
   open clients/ios/App/App.xcodeproj
   ```

3. In Xcode, select the **App** scheme and **Any iOS Device**, then **Product › Archive**.
4. In the Organizer, choose **Distribute App › TestFlight & App Store**.

Automatic signing registers these identifiers on first archive:

- Your `HELLUM_BUNDLE_ID` and its `.VoiceActivity`, `.Share`, and `.NotificationService` extensions
- App group `group.` followed by your `HELLUM_BUNDLE_ID`
- Push Notifications on the app ID

Create the app record in App Store Connect with your `HELLUM_BUNDLE_ID` before uploading.

## Develop

```sh
cd bridge
bun test              # unit and integration tests against a fake Hermes gateway
bun run typecheck
bun run test:e2e      # drives the real web UI against your real Hermes (uses your model credits)
```

Useful scripts in `bridge/scripts/`:

| Script | Does |
| --- | --- |
| `check-hermes.ts` | Starts a throwaway bridge against the running Hermes gateway and checks it attaches and serves chats, skills, schedules, and model settings. Exits non-zero on failure. Run with `bun run check:hermes`. |
| `record-hermes-trace.ts` | Records raw Hermes gateway output for a prompt, to refresh test fixtures. |
| `probe-ui.ts` | Loads the UI headlessly and lists every request and console error. |
| `probe-shot.ts` | Screenshots the UI at a given viewport. |

## License

MIT. Hellum's own code is under `LICENSE`. The Vellum clients and packages keep their original MIT notice in `LICENSE.vellum`.
