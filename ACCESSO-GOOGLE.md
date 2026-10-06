# Accesso con Google e indirizzo gratuito

Scelta dell'utente del 6 ottobre 2026: mantenere l'indirizzo gratuito Cloudflare, senza acquistare fungometer.com. L'acquisto del dominio e Resend non sono più prerequisiti del percorso scelto.

URL: https://fungometer.chiarolanza-francesco.workers.dev

Contatto pubblico confermato dall'utente il 6 ottobre 2026: **fungometer@gmail.com**, nuovo account Google dedicato. Non pubblicare l'email personale precedente. Il nome del titolare rimane da confermare separatamente.

Dopo conferma esplicita dell'utente, assegnato e verificato nella tabella IAM il ruolo `roles/oauthconfig.editor` a `fungometer@gmail.com` nel solo progetto dedicato. Consente di modificare configurazione e credenziali OAuth fino a revoca; l'account personale rimane proprietario. Nessuna concessione di accesso alla posta o alla fatturazione. L'utente ha completato personalmente l'accettazione dei termini Google Cloud e l'accesso con l'account dedicato è stato verificato. Aggiunto anche `roles/serviceusage.serviceUsageViewer`, ruolo di sola lettura suggerito dalla console per `serviceusage.quotas.get`: necessario per aprire Google Auth Platform. Verificati il salvataggio IAM, la propagazione e l'apertura di Google Auth Platform con il nuovo account.

Progetto Google dedicato creato: **Fungometer**, ID **skilful-reserve-510813-g8**. Nessuna fatturazione attivata. Configurazione iniziale compilata con nome FungoMeter, assistenza e contatto sviluppatore fungometer@gmail.com, pubblico Esterno (test). L'utente ha accettato personalmente le Norme relative ai dati utente dei servizi API Google; la console ha confermato «Configurazione OAuth creata». Il nuovo account non può aprire la creazione client perché la console richiede anche `iam.serviceAccounts.list`: nessun ulteriore ruolo assegnato, il modulo client è stato preparato usando l'account proprietario già autorizzato. Tipo Applicazione web, nome FungoMeter web, un solo redirect HTTPS esatto indicato sotto, nessuna origine JavaScript e nessuna opzione AI agent. Il pulsante Crea è pronto ma non premuto: attende conferma per creare le credenziali e trasferire il solo segreto nei segreti Cloudflare del worker Fungometer. L'accesso pubblico rimane disabilitato.

## Configurazione

- Tipo client: applicazione web.
- Nome client proposto: FungoMeter web.
- URI di reindirizzamento esatto: `https://fungometer.chiarolanza-francesco.workers.dev/api/auth/google/callback`.
- Il flusso è server-side: non richiede origini JavaScript aggiuntive.
- Ambiti richiesti dal codice: solo `openid email`. Nessun accesso Gmail, Drive, contatti o token di aggiornamento.
- `AUTH_PROVIDER=google`, `GOOGLE_CLIENT_ID` nei parametri; `GOOGLE_CLIENT_SECRET` tra i segreti Cloudflare. `AUTH_SECRET` è già configurata.
- Il client secret non deve comparire in chat, codice pubblico, screenshot o log. Il client ID è pubblico.
- Il dominio gratuito è concesso da Cloudflare; non dichiarare di possedere l'intero workers.dev. Per eventuale verifica del brand seguire i requisiti Google relativi al sottodominio effettivamente controllato. Non promettere approvazione del brand prima della verifica.
- L'email per assistenza Google può essere mostrata agli utenti: pubblicare solo un recapito confermato dal gestore.

## Protezioni implementate e verificate

State casuale legato al browser con cookie HttpOnly, scadenza 10 minuti e consumo atomico. Scambio codice con PKCE. Verifica crittografica della firma Google, issuer, audience, scadenza, nonce, identificativo stabile ed email verificata. I token Google non sono conservati. L'account usa l'identificativo Google stabile, quindi un cambio email non riavvia la prova. Nessuna unione automatica con account preesistenti soltanto perché condividono un indirizzo email.

L'accesso non avvia i 7 giorni: serve l'attivazione esplicita. La modalità Google disabilita gli endpoint di accesso via codice email; Resend e Turnstile non sono necessari a questo percorso. Gli utenti senza account Google non possono accedere con questa configurazione iniziale.

La configurazione locale è distinta dalla pubblica. Per il vecchio accesso email locale usare `AUTH_PROVIDER=email` in `.dev.vars`. Le nuove migrazioni si applicano con Wrangler prima del deploy. I test Google usano chiavi generate nei test e risposte simulate, non credenziali reali o email reali.

## Prima di abilitare al pubblico

Completare client/consenso Google e recapiti; verificare login reale e disconnessione; completare informativa e condizioni della prova; collegare aggiornamento meteo/licenza. La pubblicazione dell'interfaccia con il pulsante disabilitato non significa che Google sia già collegato. Stripe rimane in test.

Fonti tecniche: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [stati di pubblicazione e ambiti di identità](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [libreria jose](https://github.com/panva/jose).
