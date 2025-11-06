# Architecture - Améliorations

Ce document décrit les améliorations architecturales apportées au projet pour résoudre les problèmes de séparation des responsabilités et de gestion des erreurs.

## 1. Séparation des responsabilités

### Couche de services

Une nouvelle couche de services a été créée pour extraire la logique métier des routes :

- **`services/band-service.js`** : Gestion de la logique métier pour les groupes (bands)
  - Récupération des groupes
  - Vérification de la propriété des transactions
  - Gestion des catégories

- **`services/transaction-service.js`** : Gestion de toute la logique métier pour les transactions
  - CRUD complet des transactions
  - Validation des transactions (admin)
  - Filtrage et récupération des transactions

- **`services/document-service.js`** : Gestion des documents Google Drive
  - Création de dossiers
  - Upload de documents
  - Suppression de dossiers

- **`services/sync-service.js`** : Synchronisation avec Google Sheets
  - Synchronisation des transactions vers Google Sheets

### Avantages

- **Réutilisabilité** : La logique métier peut être réutilisée par plusieurs routes
- **Testabilité** : Les services peuvent être testés indépendamment des routes
- **Maintenabilité** : Les modifications de la logique métier sont centralisées
- **Routes plus simples** : Les routes ne contiennent plus que la logique de routage

### Middleware d'authentification consolidé

Le nouveau middleware `requireRole(...roles)` remplace les trois middlewares précédents :

```javascript
// Avant
requireAuth()   // N'importe quel utilisateur authentifié
requireAdmin()  // Admin seulement
requireBand()   // Band seulement

// Maintenant (mais les anciennes fonctions sont toujours supportées)
requireRole()                    // N'importe quel utilisateur authentifié
requireRole(ROLES.ADMIN)         // Admin seulement
requireRole(ROLES.BAND)          // Band seulement
requireRole(ROLES.ADMIN, ROLES.BAND)  // Admin OU Band
```

### Avantages

- **Flexibilité** : Support de plusieurs rôles dans une seule déclaration
- **DRY** : Pas de code dupliqué
- **Extensibilité** : Facile d'ajouter de nouveaux rôles

## 2. Gestion des erreurs centralisée

### Classes d'erreurs personnalisées

Nouvelles classes d'erreurs dans `lib/errors.js` :

- **`AppError`** : Classe de base pour toutes les erreurs
- **`NotFoundError`** : Ressource non trouvée (404)
- **`ValidationError`** : Erreur de validation (400)
- **`UnauthorizedError`** : Non autorisé (401)
- **`ForbiddenError`** : Accès refusé (403)
- **`ConflictError`** : Conflit (409)
- **`ExternalServiceError`** : Erreur de service externe (502)

Chaque classe d'erreur :
- A un code HTTP approprié
- Contient un message technique (pour les logs)
- Contient un message utilisateur convivial (pour l'affichage)

### Middleware de gestion d'erreurs

Nouveau système dans `lib/error-handler.js` :

- **`flashMiddleware`** : Système de messages flash cohérent
  - `req.flash.success(message)` : Messages de succès
  - `req.flash.error(message)` : Messages d'erreur
  - `req.flash.warning(message)` : Messages d'avertissement

- **`errorHandler`** : Gestionnaire d'erreurs global
  - Logs tous les erreurs
  - Affiche des messages conviviaux à l'utilisateur
  - Gère les requêtes AJAX (JSON) et normales (HTML)
  - Support pour les redirections avec flash messages
  - Note: Express 5+ gère nativement les erreurs asynchrones, pas besoin d'asyncHandler

- **`notFoundHandler`** : Gestionnaire pour les routes 404

### Avantages

- **Cohérence** : Tous les messages d'erreur passent par le même système
- **Sécurité** : Les messages techniques ne sont jamais exposés à l'utilisateur
- **Logging** : Toutes les erreurs sont automatiquement loggées
- **UX améliorée** : Messages d'erreur en anglais, clairs et cohérents

## 3. Migration des routes

Les routes ont été refactorisées pour utiliser :

1. **Les services** au lieu d'appeler directement la DB
2. **`req.flash`** pour les messages au lieu de query params
3. **Les classes d'erreurs personnalisées** dans les services
4. **Async/await natif** - Express 5+ gère automatiquement les erreurs des fonctions async

### Exemple de migration

#### Avant :
```javascript
router.post('/transactions', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }
        // ... logique métier complexe ...
        res.redirect('/transactions?success=' + encodeURIComponent('Transaction created'));
    } catch (error) {
        console.error('Error:', error);
        res.redirect('/transactions?error=' + encodeURIComponent('Failed: ' + error.message));
    }
});
```

#### Après :
```javascript
router.post('/transactions', requireBand, async (req, res) => {
    const band = await bandService.getBandByUser(req.session.user.id);
    await transactionService.create({ ... });
    req.flash.success('Transaction created successfully');
    res.redirect('/transactions');
});
```

## 4. Fichiers modifiés

- ✅ `lib/errors.js` (nouveau)
- ✅ `lib/error-handler.js` (nouveau)
- ✅ `lib/middleware.js` (modifié)
- ✅ `services/band-service.js` (nouveau)
- ✅ `services/transaction-service.js` (nouveau)
- ✅ `services/document-service.js` (nouveau)
- ✅ `services/sync-service.js` (nouveau)
- ✅ `routes/transactions.js` (refactorisé)
- ✅ `routes/admin-transactions.js` (refactorisé)
- ✅ `server.js` (modifié)
- ✅ `views/error.ejs` (nouveau)
- ✅ `views/partials/messages.ejs` (modifié)

## 5. Compatibilité

- Les anciennes fonctions `requireAuth`, `requireAdmin`, `requireBand` sont toujours disponibles
- Elles utilisent en interne la nouvelle fonction `requireRole`
- Pas de breaking changes pour les autres routes non encore migrées
