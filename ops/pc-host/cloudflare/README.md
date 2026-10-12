# Local Cloudflare VPC entry candidate

Prepared 2026-10-11. This folder has not provisioned or deployed any Cloudflare
resource and does not establish public or production readiness.

The proposed path is a fixed HTTPS
`<worker>.<account-subdomain>.workers.dev` address, one Worker `PC_APP` VPC Service
binding, a persistent named Cloudflare Tunnel, and this PC's loopback app gateway.
The 2026-10-12 candidate keeps Next, Auth, REST and private images on the PC;
R2 is an optional encrypted-backup destination under a separate owner. Existing
cloud Auth/images remain until actual migration is accepted. No Quick Tunnel,
endpoint lease/discovery, fallback, retry, or
second data path is involved.

## Acceptance contract

`APP_PUBLIC_ORIGIN` must be the same exact HTTPS origin in the Worker, PC gateway,
and Next runtime. Other public Worker aliases are rejected. Modifying requests
require that exact `Origin`; authentication and application authorization remain
the app's responsibility. Request method, path, query, application headers,
cookies and body reach the one binding. Proxy/internal and hop headers are
removed. The upstream Response passes through unchanged, retaining streaming,
separate `Set-Cookie` values and browser-visible redirects. Each request has at
most one dispatch. A transport exception returns a generic, uncached 503; a write
whose result is unknown is never resent. A response stream interrupted after
headers has been returned fails to the client rather than starting another fetch.

The VPC Service must be configured as **HTTP**, pinned to the intended named
Tunnel ID and **127.0.0.1 plus the dedicated gateway port**, with only `http_port`
enabled. Do not point it at Next directly, a DB, Studio, Auth/admin API or another
network service. The Worker uses an `http://<fixed-public-host>/...` fetch URL:
Cloudflare routes to the destination configured in the VPC Service; the URL host
supplies HTTP `Host`. Traffic is encrypted through the Tunnel and plaintext only
between the connector and the gateway on the same PC. This host behavior still
requires proof through the real deployed route.

## Local checks

From the repository root, using the isolated candidate's Node runtime:

```powershell
node --test ops/pc-host/cloudflare/worker.test.mjs ops/pc-host/cloudflare/config.test.mjs
node ops/pc-host/cloudflare/check-config.mjs
```

The second command intentionally exits 1 while the checked-in template contains
placeholders. It performs no network/provider operation. The tests use only fake
bindings and synthetic requests, responses, streams and IDs; they do not load
credentials or verify Cloudflare itself.

For later authorized configuration, make an ignored `wrangler.local.json` beside
the template. Fill exactly three placeholders: fixed Worker `name`, the complete
`https://<name>.<account-subdomain>.workers.dev` `APP_PUBLIC_ORIGIN`, and the VPC
Service UUID. Keep the one `PC_APP` binding, `remote: true`, and `workers_dev: true`.
Then run:

```powershell
node ops/pc-host/cloudflare/check-config.mjs ops/pc-host/cloudflare/wrangler.local.json
```

Passing this check proves local configuration shape only. It does not verify the
bound service's actual destination, account access, quota, connector, or routing.
No deployment command is part of these local checks.

## Actual integration gate and free-plan boundary

Before cutover, verify the intended account's VPC access/roles and fixed hostname;
verify the service is pinned to this gateway; install the named connector under
the intended runtime policy; prove the route under normal and unavailable-PC
conditions. Cloudflare currently requires `cloudflared` 2025.7.0 or newer and
QUIC (`auto`/`quic`) with outbound UDP 7844. Verify connector restart and network
changes as well as Next pages/assets, RSC streaming, Server Actions, login and
Google callback cookies/redirects, CSRF rejection, private images/uploads,
multiple cookies, and an interrupted write with no replay. Update Auth redirect
allowlists only within the separately authorized cutover scope. A synthetic
transport test cannot establish these checks or actual user/device behavior.

As checked on 2026-10-11, Workers VPC is **open beta, free on all Workers plans
only while beta**; features/APIs may change and future pricing is not guaranteed.
Normal Workers quotas apply: Free currently allows 100,000 inbound requests per
day/account and 10 ms CPU per request. Requests proxied from the PC invoke the
Worker, including its PC-served assets. Cloudflare describes `workers.dev` as
intended for personal/hobby, noncritical projects and recommends a custom domain
for production. An owned domain is not technically required for this VPC path,
but neither perpetual free pricing nor production suitability has been proved.

Primary sources:

- [VPC setup and all-plan beta availability](https://developers.cloudflare.com/workers-vpc/get-started/)
- [Official private website example using workers.dev](https://developers.cloudflare.com/workers-vpc/examples/private-api/)
- [VPC destination and Host behavior](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/)
- [Named Tunnel, no public ingress requirement, QUIC/version prerequisites](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/)
- [VPC beta pricing](https://developers.cloudflare.com/workers-vpc/platform/pricing/)
- [workers.dev hostname and intended use](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Request/manual redirect behavior](https://developers.cloudflare.com/workers/runtime-apis/request/)
