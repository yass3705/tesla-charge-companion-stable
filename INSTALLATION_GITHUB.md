# Installation de Tesla Charge Companion V6.0 stable

## Remplacer la version actuelle

1. Décompresse `Tesla_Charge_Companion_V6_0_Stable.zip`.
2. Ouvre GitHub Desktop.
3. Sélectionne ton dépôt Tesla Charge Companion.
4. Clique sur **Repository → Show in Finder**.
5. Copie tout le contenu du dossier V6.0 dans le dossier local du dépôt.
6. Accepte le remplacement des fichiers.
7. Vérifie que `.github/workflows` contient uniquement :
   - `pages.yml`
   - `update-fx.yml`
8. Dans GitHub Desktop, saisis : `Passage à la V6.0 stable`.
9. Clique sur **Commit to main**.
10. Clique sur **Push origin**.

GitHub Pages republiera automatiquement le site.

## Autoriser la mise à jour quotidienne des devises

Dans GitHub :

1. **Settings → Actions → General**.
2. Dans **Workflow permissions**, sélectionne **Read and write permissions**.
3. Enregistre.

Le workflow `Mise à jour des devises` s’exécute chaque jour à 03:37 UTC. Tu peux aussi le lancer manuellement depuis l’onglet **Actions**.

## Vérification

Après la publication :

1. ouvre ton site GitHub Pages ;
2. vérifie la mention **Version 6.0 stable** ;
3. ouvre l’onglet **Devises** et vérifie la date de mise à jour ;
4. ouvre l’onglet **Bornes** et utilise **Modifier** pour corriger manuellement un tarif Tesla.
