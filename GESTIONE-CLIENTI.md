# Gestione dei primi clienti

7 ottobre 2026. La modalità pubblicata resta di collaudo riservato: pagamenti simulati, nessun incasso reale.

## Ogni giorno, dopo l'apertura

1. Aprire il proprio account e controllare «Richieste e conferme — gestore».
2. Per ogni acquisto reale confermato, scaricare il documento con le condizioni accettate. In Gmail allegarlo a una conferma inviata da fungometer@gmail.com all'indirizzo mostrato per quell'ordine. In alternativa usare il file EML in un programma compatibile.
3. Solo dopo l'invio effettivo premere «Segna come inviata». Scaricare un file o premere quel pulsante **non invia un'email**. Inviare la conferma prontamente; non aspettare la fine della prova o una richiesta del cliente. Per volumi maggiori automatizzare questo invio prima di aumentare la pubblicità.
4. Gestire le richieste ricevute e comunicare l'esito. La chiusura della richiesta è un registro, non esegue rimborsi o cancellazioni.
5. Verificare la data meteo e il risultato dell'aggiornamento quotidiano. Il cron Cloudflare pulisce gli accessi: il meteo è generato da GitHub Actions.

La conferma HTML è una copia delle condizioni e dell'ordine. **Non è una fattura fiscale**. Le ricevute Stripe, le impostazioni email di Stripe e gli adempimenti contabili devono essere configurati secondo l'inquadramento dell'attività. I primi ordini di test, antecedenti alla funzione, non vengono retroattivamente dotati di condizioni inventate.

## Testo per accompagnare la conferma

Ciao,
confermo il tuo ordine FungoMeter [riferimento]. In allegato trovi i dettagli del pass e le condizioni accettate, da conservare.
Per assistenza o richieste relative all'ordine puoi rispondere a questa email.
FungoMeter — Francesco Chiarolanza
Via degli Estensi 1, 00164 Roma, Italia

## Recesso e rimborsi

Non viene offerta una garanzia commerciale aggiuntiva, come richiesto dal gestore. Restano i diritti applicabili per legge: il solo pagamento non li elimina. I testi sono da validare prima delle vendite.

Controllare identità, ordine, date, motivo della richiesta e norme applicabili. Per i rimborsi dovuti, operare sulla transazione corretta in Stripe; verificare esito e revoca del pass, quindi comunicare al cliente quanto fatto. Non chiedere dati della carta. I rimborsi parziali e le contestazioni possono revocare il pass: valutarne gli effetti prima di eseguirli. Nessun rimborso viene disposto dalla sezione richieste.

## Privacy e cancellazioni

La richiesta fatta dall'account è già collegata all'utente autenticato. Non chiedere un documento senza una necessità proporzionata. La scadenza delle richieste privacy è un mese di calendario; eventuali proroghe richiedono valutazione e comunicazione nei termini.

La cancellazione amministrativa è consentita soltanto per utenti con richiesta esplicita aperta e senza alcun ordine. Elimina account, sessioni, eventi e richieste associate. Richiede di digitare l'indirizzo corretto e non è reversibile attraverso l'app: prima completare eventuale consegna dei dati e predisporre la comunicazione dell'esito. L'account gestore è protetto.

Con ordini presenti, il comando si ferma: valutare documenti da conservare, contestazioni, accessi residui e dati non più necessari. Non eliminare documenti contabili o di pagamento senza questa verifica. Definire col professionista i termini di conservazione prima di aprire le vendite. I preferiti locali devono essere rimossi dal browser dell'utente.

## Incidenti e ripristino

Se un pagamento non appare confermato, controllare Stripe e webhook prima di far pagare nuovamente. Conservare il riferimento dell'ordine; non copiare chiavi o dati di carte nelle note. In caso di errore di rilascio ripristinare la precedente versione Worker; non annullare migrazioni che contengono già ordini.

Prima di migrazioni esportare D1 in un file escluso da Git. Il backup contiene dati personali: accesso limitato e rimozione secondo una politica di conservazione definita. Non usare backup reali come dati di test. Il processo quotidiano non deve esportare database o caricare dati utenti negli artefatti pubblici di GitHub.
