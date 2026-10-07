# Accesso con Google e indirizzo gratuito

Scelta dell'utente del 6 ottobre 2026: mantenere l'indirizzo gratuito Cloudflare, senza acquistare fungometer.com. L'acquisto del dominio e Resend non sono più prerequisiti del percorso scelto.

URL: https://fungometer.chiarolanza-francesco.workers.dev

Contatto pubblico confermato dall'utente il 6 ottobre 2026: **fungometer@gmail.com**, nuovo account Google dedicato. Non pubblicare l'email personale precedente. Titolare e gestore confermato: **Francesco Chiarolanza**.

Dopo conferma esplicita dell'utente, assegnato e verificato nella tabella IAM il ruolo `roles/oauthconfig.editor` a `fungometer@gmail.com` nel solo progetto dedicato. Consente di modificare configurazione e credenziali OAuth fino a revoca; l'account personale rimane proprietario. Nessuna concessione di accesso alla posta o alla fatturazione. L'utente ha completato personalmente l'accettazione dei termini Google Cloud e l'accesso con l'account dedicato è stato verificato. Aggiunto anche `roles/serviceusage.serviceUsageViewer`, ruolo di sola lettura suggerito dalla console per `serviceusage.quotas.get`: necessario per aprire Google Auth Platform. Verificati il salvataggio IAM, la propagazione e l'apertura di Google Auth Platform con il nuovo account.

Progetto Google dedicato creato: **Fungometer**, ID **skilful-reserve-510813-g8**. Nessuna fatturazione attivata. Configurazione iniziale compilata con nome FungoMeter, assistenza e contatto sviluppatore fungometer@gmail.com, pubblico Esterno (test). L'utente ha accettato personalmente le Norme relative ai dati utente dei servizi API Google; la console ha confermato «Configurazione OAuth creata». Il nuovo account non può aprire la creazione client perché la console richiede anche `iam.serviceAccounts.list`: nessun ulteriore ruolo assegnato, il modulo client è stato preparato usando l'account proprietario già autorizzato. Tipo Applicazione web, nome FungoMeter web, un solo redirect HTTPS esatto indicato sotto, nessuna origine JavaScript e nessuna opzione AI agent. Dopo conferma dell'utente, client creato e verificato nell'elenco Google: `751296262314-2ie6p5ffcu8iodmpeek0g7csiqg2ahp8.apps.googleusercontent.com`. `GOOGLE_CLIENT_SECRET` salvato nei segreti Cloudflare; valore mai mostrato in chat o salvato nel repository. Copie temporanee (incluso il download JSON) rimosse dopo conferma del salvataggio. Identificativo pubblicato nella configurazione del worker; stato e collaudo attuali nella sezione seguente. Registrazioni pubbliche e incassi reali rimangono disabilitati.

Branding salvato con home page, privacy e condizioni sul dominio gratuito, e `fungometer@gmail.com` come assistenza e contatto sviluppatore. Google ha aggiunto automaticamente `chiarolanza-francesco.workers.dev` come dominio autorizzato. Stato Google ancora Test, zero utenti di prova: non pubblicato in produzione, nessuna verifica del brand dichiarata. I documenti del sito restano bozze. Francesco Chiarolanza confermato come titolare dei dati e inserito nelle pagine privacy/condizioni e nella configurazione.

## Collaudo riservato del 6 ottobre 2026

Deploy `4f38a78c-0451-412a-b505-86483873aae7`: `AUTH_ENABLED=true`, `AUTH_ACCESS=owner-test`, provider Google, pagamenti test non configurati. Il server accetta soltanto l’email Google verificata uguale a `SUPPORT_EMAIL` (fungometer@gmail.com). Controllo prima di creare l’account e a ogni lettura di sessione; email OTP non utilizzabile per aggirarlo. Modalità sconosciuta, gestore assente o pagamenti live impediscono l’accesso di collaudo. Disabilitare `AUTH_ENABLED` rende inutilizzabili anche le sessioni esistenti.

46 test web superati e controllo remoto: pagine online, dati protetti, identità corretta, pagamenti disabilitati. Login Google reale, uscita e secondo accesso completati nel browser: account riconosciuto, misurazione facoltativa disattivata. Prova poi attivata personalmente dal gestore, verificata online fino al 13 ottobre 2026 ore 17:35; ricerca e dettaglio mappa verificati. La schermata Google mostra il sottodominio Cloudflare, non ancora il brand verificato.

Il collaudo del solo gestore non equivale all’apertura pubblica: le bozze legali restano un blocco per `AUTH_ACCESS=public`. Prima di estenderlo a utenti esterni completare informative e condizioni, gestione dei dati e licenze. Non usare la modalità riservata per aggirare questi passaggi.

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

La configurazione locale è distinta dalla pubblica. Per il vecchio accesso email locale usare `AUTH_PROVIDER=email` e `AUTH_ACCESS=public` in `.dev.vars`. Le nuove migrazioni si applicano con Wrangler prima del deploy. I test Google usano chiavi generate nei test e risposte simulate, non credenziali reali o email reali.

## Prima di abilitare al pubblico

Completare informativa e condizioni della prova, collegare aggiornamento meteo/licenza. Client, consenso, login reale e disconnessione Google verificati. Stripe rimane in test; checkout e rimborso simulati verificati, vedi [STRIPE-COLLAUDO.md](STRIPE-COLLAUDO.md).

Fonti tecniche: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [stati di pubblicazione e ambiti di identità](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [libreria jose](https://github.com/panva/jose).
