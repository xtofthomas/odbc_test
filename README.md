# ODBC Test

Application minimaliste (Electron + Python) pour vérifier qu'on peut se connecter
à un serveur de base de données via ODBC depuis la VM.

- liste les pilotes ODBC et DSN installés sur la machine ;
- teste une chaîne de connexion (SGBD, version, pilote, base, utilisateur) ;
- exécute une requête et affiche le résultat (200 lignes max, rollback systématique).

## Structure

```
backend/   FastAPI + pyodbc, lancé par Electron sur 127.0.0.1:<port libre>
frontend/  Electron (main.js lance le backend, renderer/ = interface)
.github/workflows/build-windows.yml   produit l'exe portable Windows
```

## Lancer en développement

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows   (Linux/macOS : source .venv/bin/activate)
pip install -r requirements.txt

cd ../frontend
npm install
npm start
```

Electron utilise `python` (Windows) ou `python3` ; pour forcer l'interpréteur du venv :
`set PYTHON=..\backend\.venv\Scripts\python.exe` avant `npm start`.

## Produire l'exe Windows

PyInstaller ne fait pas de compilation croisée : le build doit se faire sous Windows.

**Avec GitHub Actions (recommandé)** : poussez le dépôt sur GitHub, le workflow
`Build Windows portable` produit `ODBC-Test-x.y.z.exe`, à télécharger dans l'onglet
*Actions → dernier run → Artifacts*.

**Sur un PC Windows** :

```bat
cd backend
pip install -r requirements.txt pyinstaller
pyinstaller --noconfirm --onedir --noconsole --name backend --collect-submodules uvicorn app.py
cd ..\frontend
npm install
npm run dist
```

## Sur la VM

1. Copier `ODBC-Test-x.y.z.exe` dans un dossier où vous pouvez écrire.
2. Double-cliquer : aucune installation ni droit admin nécessaire.
3. `config.json` (chaîne de connexion) est enregistré à côté de l'exe.

## Bon à savoir

- **Pilotes** : pyodbc utilise les pilotes ODBC déjà installés sur la VM, et en installer
  un nouveau demande des droits admin. Windows inclut toujours l'ancien pilote `SQL Server` ;
  `ODBC Driver 17/18 for SQL Server` est souvent présent sur les serveurs. La liste affichée
  au démarrage vous dit ce qui est disponible.
- **DSN utilisateur** : `odbcad32.exe` → onglet *DSN utilisateur* se configure sans être admin.
  On s'y connecte ensuite avec `DSN=MonDSN;`.
- **Mots de passe** : `config.json` est en clair. Préférez l'authentification Windows
  (`Trusted_Connection=yes`) quand le serveur le permet.
- **Terminal Server** : chaque session lance son propre backend sur un port libre, protégé
  par un jeton aléatoire (les sessions partagent 127.0.0.1).
