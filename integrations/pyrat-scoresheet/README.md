# External PyRAT scoresheet

This service is independent from eLabFTW. It is intended for a network-reachable facility host while eLabFTW may remain on a local server.

It reads animal data directly from PyRAT and, only after explicit configuration, sends approved scores directly to PyRAT. eLabFTW never handles the score submission or the PyRAT write credential.

## Start in demo mode

```bash
cp .env.example .env
# replace PORTAL_ACCESS_CODE with a long random secret
docker compose up -d --build
```

Open `http://HOST:8080`. A deep link such as `http://HOST:8080/?entity_type=animal&entity_id=M1234` preselects an animal after authentication.

Demo submissions are appended to `data/submissions.ndjson`. Each submission includes the animal and cage identifiers, experiment and permit details, experimenter/contact, observation date and observer, procedure and weight, administered medication details, Yes/No welfare observations, total score, and comments. The **Previous entries** buttons read this persisted history globally or for one animal. History is grouped by experiment: common experiment/permit/contact details are shown once, followed by a horizontally scrollable table of the animal-specific records.

Live PyRAT writes require both a validated `PYRAT_SCORES_PATH` and `PYRAT_SCORE_WRITE_ENABLED=true`. Live history additionally requires the institution's read endpoint in `PYRAT_SCORES_READ_PATH`; it is deliberately not inferred from the write endpoint.

For production, place the service behind institutional HTTPS and preferably VPN/SSO with individual observer identities. Replace the included demonstration criteria with the facility-approved scoresheet and escalation workflow before use.
