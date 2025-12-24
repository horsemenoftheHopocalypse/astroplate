# Brewer Spotlight Template

Copy the section below and paste it into the `spotlights` array in:
`src/content/sections/brewer-spotlight.md`

---

```yaml
  - name: "FirstName LastName"
    avatar: "/images/avatar.png"
    designation: "Homebrewer"
    date: "Month Day, Year"
    questions:
      - question: "Tell us about your first batch of homebrew. When did you start?"
        answer: ""
      
      - question: "What's your favorite beer you've ever brewed?"
        answer: ""
      
      - question: "What about your biggest brew-fail?"
        answer: ""
      
      - question: "What's your go-to commercial beer?"
        answer: ""
      
      - question: "What's in your fermenter now?"
        answer: ""
      
      - question: "What's your favorite BJCP style to brew? To drink?"
        answer: ""
      
      - question: "Tell us about your brewery. What does your set-up look like?"
        answer: ""
      
      - question: "Why do you homebrew?"
        answer: ""
```

---

## Instructions:

1. Copy the YAML section above (from `- name:` to the last `answer: ""`)
2. Open `src/content/sections/brewer-spotlight.md`
3. Paste it into the `spotlights:` array (after the last existing entry)
4. Fill in the details:
   - **name**: Full name of the brewer
   - **avatar**: Path to their photo (e.g., `/images/john-doe.jpg`)
   - **designation**: Their role/title (e.g., "Homebrewer", "Club President", etc.)
   - **date**: Interview date in format "Month Day, Year"
   - **questions**: Fill in the answers for each question

## Tips:

- Keep answers concise for better display on cards
- Use proper YAML indentation (spaces, not tabs)
- Add or remove questions as needed
- The first 3 questions will show on the preview card
- All questions appear on the detail page

## Optional Questions to Add:

```yaml
      - question: "What brewing resources do you recommend?"
        answer: ""
      
      - question: "What's your dream beer to brew?"
        answer: ""
      
      - question: "Any competition wins or achievements?"
        answer: ""
```
