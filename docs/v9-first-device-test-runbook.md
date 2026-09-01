# TCC V9 — Premier test réel mono-appareil

Ce runbook ne bascule pas la production. V8 reste la valeur par défaut et le canary aléatoire doit rester à 0 % pendant toute l'opération.

## 0. Conditions obligatoires avant ouverture

Le test est interdit tant que l'un de ces points n'est pas vert sur le HEAD à tester :

- V9 production readiness gate
- V9 access gateway safety
- V9 controlled device test safety
- V9 device test window console safety
- V9 rollout safety gate
- V9 shadow parity

Le dépôt doit aussi être dans l'état fermé suivant :

- `rollout.stage = preview`
- `rollout.canaryPercent = 0`
- `rollout.killSwitch = false`
- `rollout.canaryPath = v9-app/`
- self-enroll désactivé et sans hash de token
- `access-readiness = BLOCKED`
- politique de test appareil désactivée

Exécuter `node scripts/v9-first-device-test-runbook.cjs` pour contrôler cet état.

Le CI valide ensuite `node scripts/v9-validate-device-test-config.cjs`. Ce contrôle accepte
uniquement l'état fermé ci-dessus ou une fenêtre contrôlée cohérente, active et bornée à
60 minutes. Un état partiellement ouvert ou une fenêtre expirée bloque tous les garde-fous.

## 1. Préparer la fenêtre

Ouvrir `v9-device-test-console/` et générer une fenêtre de test de 30 à 60 minutes.

La console doit produire :

1. un token en clair, conservé uniquement sur l'appareil de test ;
2. un plan OUVRIR contenant uniquement le SHA-256 du token ;
3. un plan FERMER symétrique.

Ne jamais committer le token en clair.

## 2. Appliquer OUVRIR

Appliquer uniquement les modifications générées par le plan OUVRIR :

- self-enroll activé ;
- hash du token renseigné ;
- readiness d'accès `READY` ;
- politique mono-appareil activée ;
- expiration bornée ;
- canary toujours à 0 %.

Attendre les workflows du nouveau HEAD. Si un gate requis échoue, appliquer immédiatement FERMER et arrêter le test.

## 3. Enrôler l'appareil

Sur l'appareil de test :

1. ouvrir `v9-app/` ;
2. saisir le token en clair dans le bloc self-enroll ;
3. confirmer que le grant temporaire est actif avec une expiration ;
4. ouvrir `v9-gate/` ;
5. vérifier que la décision indique `V9`, source `self_enroll`, cible `v9-app/`.

Toute autre décision impose l'arrêt du test.

## 4. Exécuter les 10 runs minimum

Effectuer au moins 10 requêtes représentatives avec des cas variés de stations, coûts, puissances, routage et abonnements déjà disponibles dans le candidat.

Critères de rollback immédiat :

- erreur source ;
- erreur de routage ;
- readiness qui cesse d'être `READY` ;
- kill-switch activé ;
- canary aléatoire différent de 0 % ;
- latence moyenne au-dessus de la limite de la politique ;
- taux d'échec au-dessus de la limite ;
- comportement de routage V8/V9 inattendu.

## 5. Décision

Le moteur `device-test-engine` peut conclure :

- `OBSERVE` : continuer jusqu'au minimum de runs ou expiration ;
- `PASS` : test réussi, mais fermeture obligatoire ;
- `ROLLBACK` : fermer immédiatement ;
- `CLOSE` : fenêtre expirée, fermer ;
- `CLOSED` : test déjà fermé.

Même après `PASS`, la fenêtre n'est jamais laissée ouverte.

## 6. Appliquer FERMER

Appliquer le plan FERMER :

- self-enroll désactivé ;
- hash du token vidé ;
- readiness d'accès remise à `BLOCKED` ;
- politique appareil désactivée.

Le grant local peut ensuite être révoqué sur l'appareil.

## 7. Contrôle post-fermeture

Vérifier :

- `node scripts/v9-first-device-test-runbook.cjs` repasse entièrement au vert ;
- les workflows requis sont verts sur le HEAD de fermeture ;
- `v9-gate/` renvoie l'appareil vers V8 ;
- `canaryPercent` est toujours à 0 % ;
- aucun token en clair n'existe dans le dépôt.

Ce runbook couvre uniquement le premier test mono-appareil contrôlé. Il ne constitue pas une autorisation de passage au canary 1 %.
