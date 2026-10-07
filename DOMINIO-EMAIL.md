# Collegamento dominio ed email — 6 ottobre 2026

**Percorso superato dalla scelta successiva dell'utente:** mantenere workers.dev e usare Google per l'accesso. Non acquistare il dominio o configurare Resend sulla base di questo documento. Lo stato corrente è in [ACCESSO-GOOGLE.md](ACCESSO-GOOGLE.md). Le indicazioni sotto restano un'opzione futura.

Dominio scelto dall'utente: **fungometer.com**. Cloudflare lo mostrava disponibile a **10,46 USD/anno**, rinnovo attuale 10,46 USD/anno. Imposte escluse dal subtotale: totale da verificare dopo inserimento dati. Rinnovo automatico attivo nel riepilogo. Acquisto non ancora confermato.

## Preparazione completata

- Aperto il riepilogo Cloudflare per 1 anno e la registrazione Resend.
- Il codice invia codici monouso con Resend e mantiene un limite condiviso di 80 tentativi di invio al giorno, oltre ai limiti per indirizzo e IP. Massimo teorico 2.480 in 31 giorni per questa applicazione; lasciare disattivati gli addebiti per superamento quota e non condividere il budget con altre applicazioni senza ricalcolarlo.
- La verifica Turnstile controlla anche dominio e azione; nessun codice viene restituito al browser pubblico. Risposta alle email diretta a SUPPORT_EMAIL quando configurata. Nessuna email reale inviata durante questa preparazione.
- Chiave interna AUTH_SECRET generata e salvata in Cloudflare, senza valore in chat o su disco. Script `node scripts/ensure-auth-secret.mjs`: inizializza una chiave casuale solo se mancante, direttamente in Cloudflare. Non ruota chiavi esistenti.

## Dopo l'acquisto e l'accesso a Resend

1. Verificare proprietà e stato attivo del dominio in Cloudflare. Completare personalmente l'eventuale email ICANN. Non considerare il dominio disponibile come già acquistato.
2. Aggiungere `fungometer.com` come dominio personalizzato del Worker e verificare HTTPS. Solo dopo cambiare APP_ORIGIN e configurare l'inoltro dal vecchio workers.dev; evitare di spezzare l'anteprima prima che il dominio funzioni.
3. In Resend verificare il sottodominio `mail.fungometer.com`, preferendo una regione europea disponibile. Aggiungere esclusivamente i record DNS forniti dall'account Resend; non inventare valori DKIM/SPF. Controllare record esistenti prima delle modifiche.
4. Mittente proposto: `FungoMeter <accesso@mail.fungometer.com>`. Tracciamento aperture/click disattivato per i codici. La verifica del dominio abilita l'invio, non crea automaticamente una casella di assistenza.
5. Scegliere un recapito di assistenza realmente consultato. Se si desidera `assistenza@fungometer.com`, configurare separatamente la ricezione/inoltro verso una casella scelta dall'utente e verificarla. Non pubblicare un indirizzo che non riceve.
6. Creare una chiave Resend con permesso solo invio e restrizione al dominio verificato. Inserirla come segreto `RESEND_API_KEY` nel Worker, senza chat o repository. Configurare `MAIL_FROM` e `SUPPORT_EMAIL` nei parametri pubblici.
7. Creare Turnstile per il dominio esatto; il sito usa l'azione `login`. Configurare chiave pubblica `TURNSTILE_SITE_KEY` e segreto `TURNSTILE_SECRET_KEY`.
8. Completare nome e recapito del titolare, documenti e tempi di conservazione. Dopo dati freschi e configurazione completa, abilitare accesso e inviare un codice reale soltanto all'indirizzo di test autorizzato dall'utente.
9. Verificare ricezione, scadenza codice, avvio prova e uscita. Acquisti sempre in test finché i prerequisiti commerciali non sono completati.

Costi verificati: [Cloudflare .com](https://pricing.registrar.cloudflare.com/); [Resend piano gratuito](https://resend.com/pricing) con 100 invii/giorno; [verifica dominio e sottodomini](https://resend.com/docs/dashboard/domains/introduction). Il limite applicativo non sostituisce la verifica del piano e della fatturazione nell'account Resend.
