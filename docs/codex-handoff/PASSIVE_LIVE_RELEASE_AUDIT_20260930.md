# Live release audit and cost containment

Verified at 2026-09-30T05:42:34.245482Z through Supabase management tools.

- Palate project healthy; migration registry lists0001–0184, including socialprivacy0183/searchblocks0184. Registry presence does not prove every deployed body matches localsource.
- Relevant edgefunctions exist; currentclassifier version7 has oldAnthropicdispatch path. Newreserve/confirm/settleLLMadmission RPCs absent. Googlebump_google_spend exists; centralreservationdraft absent. Featureflags passivecapture,discoverypings,serverpush aretrue. Olddemographiccolumns absent; oldclient rollback caveat persists.
- **LIVE CHANGE:** paused only cronjob14 `llm_cuisine_backfill` throughcron.alter_job(active:=false), then readbackconfirmedfalse. Schedule `*/10 * * * *` preserved. Nojobinvoked, no data deleted, no paidAPIcall. Already-dispatchedwork and otherpaidroutes are not cancelled orcertifiedcostfree. Existingclassifieddata retained; automaticnewcuisineenrichment paused.
- Rollback is reactivation of this samejob via cron.alter_job after costsafe admission and explicit paid-operation policy are established. Do not automaticallyreactivate merelytofinishrelease.
- Groundwork project inactive; do not silentlyresume/upgrade. VercelHobbycommercialeligibility remainsunresolved.
- This is a productionconfigurationchange, not an app/edge deployment. No apprelease yet; EASruntime/backend/costscope verification remains.
