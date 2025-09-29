# 🧑‍🎓 PASS Training API

API Express + Supabase + Nscale pour générer et gérer :  
- 📚 Cours (transcriptions Whisper + version réécrite propre)  
- ❓ QCM et questions ouvertes  
- 📝 Notation automatique par IA  
- 🎯 Système de difficulté (1 = facile, 5 = difficile)  

---

## ⚙️ Configuration

Créer un fichier `.env` à la racine du projet :

```env
# Serveur
PORT=9999
NODE_ENV=production

# Supabase
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_ANON_KEY=<anon-key> # (optionnel, pour lecture côté front)

# Nscale
NSCALE_SERVICE_TOKEN=nscl_xxxxxxxxxxxxxxxxxxxxxxxxx

# (optionnel)
LOG_LEVEL=info
MAX_TOKENS_REFINE=6000
````

---

## 📡 Endpoints disponibles

### 1. Cours

#### ➡️ POST `/api/courses`

Créer un nouveau cours (stocké dans `raw_content`).

**Body**

```json
{
  "ue_number": 3,
  "title": "Physiologie respiratoire - Ventilation",
  "content": "Texte du cours transcrit par Whisper..."
}
```

**Réponse**

```json
{
  "course": {
    "id": "edd33b55-4abc-4c41-9d31-6c52260a984d",
    "ue_number": 3,
    "title": "Physiologie respiratoire - Ventilation",
    "created_at": "2025-09-28T21:12:01.017361+00:00"
  }
}
```

---

#### ➡️ GET `/api/ues`

Liste des numéros d’UE présents.

**Réponse**

```json
{ "ues": [1, 2, 3, 4, 5] }
```

---

#### ➡️ GET `/api/ues/:ueNumber/courses`

Liste des cours pour une UE donnée.

**Réponse**

```json
{
  "courses": [
    {
      "id": "edd33b55-4abc-4c41-9d31-6c52260a984d",
      "title": "Physiologie respiratoire - Ventilation",
      "created_at": "2025-09-28T21:12:01.017361+00:00"
    }
  ]
}
```

---

#### ➡️ GET `/api/courses/:id`

Contenu complet d’un cours (transcription brute + version réécrite).

**Réponse**

```json
{
  "course": {
    "id": "edd33b55-4abc-4c41-9d31-6c52260a984d",
    "ue_number": 3,
    "title": "Physiologie respiratoire - Ventilation",
    "raw_content": "...",
    "refined_content": "...",
    "created_at": "2025-09-28T21:12:01.017361+00:00"
  }
}
```

---

### 2. Réécriture de cours

#### ➡️ POST `/api/refine-course`

Réécrit la transcription (`raw_content`) en version claire (`refined_content`).

**Body**

```json
{ "courseId": "edd33b55-4abc-4c41-9d31-6c52260a984d" }
```

**Réponse**

```json
{ "courseId":"...","refined_length":12000,"chunks":4,"ok":true }
```

---

### 3. QCM

#### ➡️ POST `/api/generate-mcq`

Génère un lot de QCM pour un cours.

**Body**

```json
{ "courseId": "edd33b55-4abc-4c41-9d31-6c52260a984d", "n": 5, "difficulty": 3 }
```

**Réponse**

```json
{
  "set_code": "7403f3f1-0708-4133-aa15-ee324e770c0b",
  "items": [
    {
      "question_id": "d2e7...",
      "set_code": "7403f3f1-0708-4133-aa15-ee324e770c0b",
      "course_id": "edd33b55-...",
      "question_index": 1,
      "question": "Quel est le rôle principal du cytosquelette ?",
      "options": { "A":"Produire de l’énergie","B":"Déterminer la forme","C":"Stocker l’information","D":"Transporter les nutriments" },
      "answer": "B",
      "explanation": "Le cytosquelette assure la forme et la stabilité de la cellule.",
      "difficulty": 3
    }
  ]
}
```

---

#### ➡️ GET `/api/questions?set_code=<set_code>`

Récupère toutes les questions d’un lot de QCM.

**Réponse**

```json
{
  "questions": [
    {
      "id": "d2e7...",
      "set_code": "7403f3f1-0708-4133-aa15-ee324e770c0b",
      "course_id": "edd33b55-...",
      "question_index": 1,
      "question": "Quel est le rôle principal du cytosquelette ?",
      "options": { "A":"...","B":"...","C":"...","D":"..." },
      "answer": "B",
      "explanation": "...",
      "difficulty": 3
    }
  ]
}
```

---

### 4. Questions ouvertes

#### ➡️ POST `/api/generate-open`

Génère un lot de questions ouvertes.

**Body**

```json
{ "courseId": "edd33b55-4abc-4c41-9d31-6c52260a984d", "n": 3, "difficulty": 4 }
```

**Réponse**

```json
{
  "set_code": "bd91...",
  "items": [
    {
      "id": "a123...",
      "set_code": "bd91...",
      "course_id": "edd33b55-...",
      "question_index": 1,
      "prompt": "Expliquez le rôle des microtubules.",
      "reference_answer": "Les microtubules sont des structures rigides impliquées...",
      "difficulty": 4
    }
  ]
}
```

---

#### ➡️ POST `/api/grade-open`

Corrige une réponse ouverte.

**Body**

```json
{
  "open_question_id": "a123...",
  "answer": "Les microtubules servent uniquement à la photosynthèse.",
  "user_id": "omar"
}
```

**Réponse**

```json
{
  "score": 0.2,
  "feedback": "La réponse est incorrecte : les microtubules n'ont aucun rôle dans la photosynthèse...",
  "breakdown": { "exactitude":0.0,"completude":0.2,"clarte":0.0 }
}
```

---

### 5. Tentatives & scores

#### ➡️ POST `/api/answer`

Enregistre une tentative de QCM (choix utilisateur).

**Body**

```json
{
  "question_id": "d2e7...",
  "user_answer": "C",
  "user_id": "omar"
}
```

**Réponse**

```json
{
  "is_correct": false,
  "correct_answer": "B"
}
```

---

#### ➡️ GET `/api/score?set_code=<set_code>&user_id=omar`

Retourne le score global d’un utilisateur sur un lot.

**Réponse**

```json
{
  "set_code":"7403f3f1-0708-4133-aa15-ee324e770c0b",
  "user_id":"omar",
  "score":0.6,
  "total":5
}
```

---

## 🏗️ Architecture rapide

* **Supabase** → stocke cours, questions et tentatives.
* **Nscale** → génère QCM, questions ouvertes, réécritures de cours.
* **Express API** → endpoints REST simples.
* **Frontend** → HTML/JS léger, consomme ces endpoints.

---

## 🚀 Lancer en local

```bash
git clone https://github.com/<username>/<repo>.git
cd <repo>
npm install
npm run dev
```

API disponible sur : `http://localhost:9999/api/...`

