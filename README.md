📄 Configuration — Variables d’environnement

Toutes les variables sont à définir dans un fichier .env à la racine du projet.
Elles servent à configurer la connexion à la base Supabase, à l’API Nscale (pour l’IA), et au serveur Express.

🌐 Serveur Express
Variable	Exemple	Description
PORT	9999	Port HTTP sur lequel ton API Express écoute.
NODE_ENV	production	(optionnel) Mode de déploiement (development ou production).
🗄️ Supabase (base de données)
Variable	Exemple	Description
SUPABASE_URL	https://liftvwqfiooctupposgf.supabase.co	URL du projet Supabase.
SUPABASE_SERVICE_ROLE_KEY	eyJhbGciOiJIUzI1NiIs...	Service Key (pas l’anon key). Utilisée côté serveur pour lire/écrire librement dans la base.
SUPABASE_ANON_KEY	eyJhbGciOiJIUzI1NiIs...	(optionnel) Clé publique, si tu veux exposer des endpoints “lecture seule” côté client.

👉 Important : n’utilise jamais l’anon key côté backend pour écrire, car elle est limitée par les policies RLS.
Toujours utiliser la SERVICE_ROLE_KEY côté serveur.

🤖 Nscale (API IA)
Variable	Exemple	Description
NSCALE_SERVICE_TOKEN	nscl_xxxxxxxx	Token privé fourni par Nscale pour appeler l’API https://inference.api.nscale.com.
🛠️ Variables optionnelles
Variable	Exemple	Description
LOG_LEVEL	debug	Niveau de logs (debug, info, warn, error).
MAX_TOKENS_REFINE	6000	(optionnel) Limite de tokens pour la réécriture de cours.
Exemple .env
# Serveur
PORT=9999
NODE_ENV=production

# Supabase
SUPABASE_URL=https://liftvwqfiooctupposgf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR...

# (optionnel, seulement si utilisé côté front)
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR...

# Nscale
NSCALE_SERVICE_TOKEN=nscl_xxxxxxxxxxxxxxxxxxxxxxxxx

# (optionnel)
LOG_LEVEL=info
MAX_TOKENS_REFINE=6000
