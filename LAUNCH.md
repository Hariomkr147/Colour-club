# Hosting and India launch assessment

Checked 10 November 2026. This is a technical assessment and a record of sources, not legal approval.

## India and the proposed real-money phase

The supplied Indian government material describes the Promotion and Regulation of Online Gaming Act, 2025 as prohibiting online money games, including chance/skill combinations and their financial facilitation. The published 2026 Rules announcement states an effective date of 1 May 2026 and describes game determination, registration categories, user-safety, transparency and grievance mechanisms. A change to terms cannot establish that a prohibited model is permissible. Sources: [MeitY Act text](https://www.meity.gov.in/static/uploads/2025/10/8a7f103cefc68ed8aaa2ebc9a2ed7c13.pdf), [PIB March announcement](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2241804&lang=2&reg=48), [PIB Rules announcement](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2254606&lang=2&reg=48).

Keep this implementation limited to freely issued, nontransferable, nonredeemable points without prizes. Before serving Indian customers, obtain advice on classification, any required determination/registration, applicable state rules, consumer transparency, data location and grievance requirements. No finding here guarantees that a points product needs no review. No real-money wallet, payments integration or cash-out switch was implemented.

The stake-dependent outcome policy must remain accurately described. Saying results are solely luck-based would conflict with the implementation. The professional site keeps a concise explanation in the rules, a required acknowledgement during signup and a reminder by the confirmation action. Detailed calculation records remain available to administrators.

## Hosting choices

| Option | Fit for this implementation | Decision |
|---|---|---|
| Render | Documented always-on Node services, PostgreSQL connections and continuous workers | Deployment template included. Use a paid always-on runtime; verify database/data location and other launch obligations separately |
| Cloudflare Workers | Can connect to PostgreSQL through Hyperdrive, but uses a different request/scheduling model | Not a drop-in target for this Node listener and sub-minute process scheduler. A port would need request entrypoints and durable scheduled round coordination. Cloudflare can front the Node deployment for DNS/TLS/CDN |
| Botkeep | Website advertises Node and PostgreSQL, continuous workloads and shared resource limits | Evaluate backup restoration, data location, isolation, operational support and current service readiness before choosing it for customer accounts |
| ModelScope.ai | The referenced page did not expose verifiable persistent Node/PostgreSQL hosting or scheduler documentation in this research | Not selected on the available evidence |

Primary sources: [Render service types](https://render.com/docs/service-types), [Render workers](https://render.com/docs/background-workers), [Render Blueprint reference](https://render.com/docs/blueprint-spec), [Cloudflare PostgreSQL/Workers guide](https://developers.cloudflare.com/workers/tutorials/postgres/), [Botkeep website](https://botkeep.cloud/), [ModelScope.ai](https://modelscope.ai/).

The template uses an externally configured database instead of automatically placing Indian user data in an assumed region. The research does not certify any vendor's contractual suitability, geographic compliance, current pricing, uptime or security.

## Deployment and remaining operations

1. Botkeep app hosting and HTTPS address are configured; confirm provider location and contractual/data-location requirements for the intended audience.
2. Supabase PostgreSQL in Mumbai, a restricted runtime role, certificate verification and a tested backup/restore process are configured. Establish independent scheduled backups and retention.
3. SMTP provider credentials, verified sender and delivery tests before enabling verification or password recovery. The owner chose immediate registration without verification for the points pilot.
4. The owner account and private authenticator bootstrap file are provisioned. The owner must enrol its authenticator and securely store the credentials.
5. Operator support/privacy/grievance contacts, retention/deletion procedures and the public terms reviewed for the exact model.
6. Measured staging load target, rate-limit sizing for shared mobile networks/proxies, monitoring and incident ownership.

The website is hosted at https://colour-club.bot-keep.xyz/ using the existing free Botkeep allocation and a separate free Supabase project. The failed Botkeep database was replaced and removed. The repository contains no public host credentials. See [BOTKEEP.md](BOTKEEP.md) and [SUPABASE.md](SUPABASE.md). Technical deployment and functional checks do not certify legal classification, uptime or a particular traffic capacity.
