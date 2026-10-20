# procv-ocr

Lecture automatique du texte des offres d’emploi publiées en image ou en PDF scanné
(MediaCongo, UBS Congo, Kivu10) pour [ProCV](https://monprocv.com).

- Moteur : [Tesseract](https://github.com/tesseract-ocr/tesseract), OCR libre et gratuit (français + anglais), sans IA.
- Fréquence : toutes les 2 heures (`.github/workflows/ocr-offers.yml`), ou à la main depuis l’onglet **Actions → Run workflow**.
- Chaque offre n’est lue qu’une fois : le texte est enregistré en haut de sa description dans Supabase, l’original reste en dessous.

## Configuration

Dans **Settings → Secrets and variables → Actions**, ajouter :

| Secret | Valeur |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → clé `service_role` |

Les journaux sont publics : le script n’y écrit que des identifiants d’offres, jamais de clé ni de donnée personnelle.

GitHub met en pause les tâches programmées d’un dépôt public après 60 jours sans commit :
cliquer sur **Enable workflow** dans l’onglet Actions pour relancer.
