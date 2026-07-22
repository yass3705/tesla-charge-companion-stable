# Version 7.1.0 Stable

- `data/exchange_rates.json` est relu sans cache au démarrage et via le bouton d’actualisation.
- La date « À propos » provient du fichier de taux réellement chargé, et non plus uniquement de `metadata.json`.
- Le cache local des devises change de version afin d’écarter les anciennes valeurs.
- Le bouton Supprimer fonctionne pour les stations personnalisées.
- Une station publiée Tesla/tiers est masquée durablement sur l’appareil via une liste locale, sans modifier GitHub.
- Les stations masquées ne réapparaissent plus au prochain chargement.

- Les coordonnées GPS sont utilisées en priorité pour les itinéraires Google Maps ; l’adresse reste affichée comme libellé.
- La mise à jour des devises enregistre la date de la source et l’heure de vérification séparément.
- Le workflow de devises affiche et valide les taux avant de les publier.
- Le bouton d’actualisation force toujours une lecture sans cache.

# Changelog

## V7.0.1 stable

- Correction définitive de la migration des anciens taux manuels.
- Le bouton « Effacer les corrections manuelles » ne permet plus au MAD de réapparaître.
- Suppression de l'ancienne clé locale lors de la remise à zéro.
- Indicateurs distincts : Publié, Manuel, Secours et Base.
- Les taux intégrés sans date sont désormais clairement marqués « Secours ».
- Réinitialisation propre de l'affichage à chaque rendu.
- Cache PWA renouvelé.

# Changelog

## V7.0 stable

- Refonte complète des devises.
- Affichage du coût local et de son équivalent EUR.
- Liste ciblée Europe + Maghreb.
- Correction du bug où un ancien taux local EUR-only masquait les taux publiés.
- Séparation entre taux publiés et corrections manuelles.
- Conservation du dernier taux valide.
- Source et date visibles dans l'interface.
- Mise à jour quotidienne avec fournisseur principal et fournisseur de secours.
- Migration automatique des anciens taux manuels.
- Cache PWA renouvelé.

## 7.1.0
- Frankfurter v2 devient la source principale des taux de change.
- open.er-api.com devient la source de secours.
- Correction du parseur pour le format tableau `{date, base, quote, rate}` de Frankfurter v2.
- Les logs GitHub Actions indiquent toujours la date source et l'heure de vérification.
