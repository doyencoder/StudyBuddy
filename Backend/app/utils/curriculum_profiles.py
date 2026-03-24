"""
curriculum_profiles.py
──────────────────────────────────────────────────────────────────────────────
Static curriculum profile blocks for the StudyBuddy curriculum-aware feature.

Maps (board, grade) → a structured context string that is appended to LLM
system prompts when the student has configured their board and grade in Settings.

Boards:  CBSE, ICSE
Grades:  Class 9, Class 10, Class 11, Class 12

Loaded once at import time. Zero I/O, zero Azure cost, ~0.01 ms lookup.
"""

from typing import Optional

# ── Profile blocks ─────────────────────────────────────────────────────────────
# Each block has 4 ordered components:
#   1. Scope       — subjects and topics in scope for this curriculum level
#   2. Vocabulary  — language and terminology expectations
#   3. Style       — preferred explanation / answer format
#   4. Exam        — exam format awareness

_PROFILES: dict[tuple[str, str], str] = {

    # ── CBSE Class 9 ──────────────────────────────────────────────────────────
    ("CBSE", "Class 9"): """CURRICULUM CONTEXT — CBSE Class 9:
Scope: Mathematics (Number Systems, Polynomials, Coordinate Geometry, Linear Equations in Two Variables, Euclid's Geometry, Lines and Angles, Triangles, Quadrilaterals, Areas, Circles, Surface Areas and Volumes, Statistics, Probability). Physics (Motion, Force and Laws of Motion, Gravitation, Work Energy Power, Sound). Chemistry (Matter in Our Surroundings, Is Matter Around Us Pure, Atoms and Molecules, Structure of the Atom). Biology (Cell — Fundamental Unit of Life, Tissues, Diversity in Living Organisms, Why Do We Fall Ill, Natural Resources, Improvement in Food Resources). Social Science (French Revolution, Socialism and Russian Revolution, Nazism; India — Size, Physical Features, Drainage, Climate; Democracy and Electoral Politics; Village Palampur Economics).
Vocabulary: Simple, textbook-friendly language for a 14–15 year old. Use NCERT-aligned vocabulary. Avoid graduate-level terminology.
Style: Show complete step-by-step working for Maths and numerical Science problems. For theory, use short structured paragraphs. Connect Science concepts to everyday examples. Where relevant, follow the CBSE 3-mark / 5-mark format: state the concept → explain → give an example.
Exam awareness: This student prepares for the CBSE Class 9 annual school examination. Answers must be NCERT-aligned — board papers are directly NCERT-based. Emphasise NCERT solved examples and exercises. Structure answers to match CBSE marking criteria.""",

    # ── CBSE Class 10 ─────────────────────────────────────────────────────────
    ("CBSE", "Class 10"): """CURRICULUM CONTEXT — CBSE Class 10:
Scope: Mathematics (Real Numbers, Polynomials, Pair of Linear Equations, Quadratic Equations, Arithmetic Progressions, Triangles, Coordinate Geometry, Trigonometry — basic ratios and identities, Applications of Trigonometry, Circles, Areas Related to Circles, Surface Areas and Volumes, Statistics, Probability). Physics (Electricity, Magnetic Effects of Electric Current, Light — Reflection and Refraction, Human Eye and Colourful World, Sources of Energy). Chemistry (Chemical Reactions, Acids Bases and Salts, Metals and Non-metals, Carbon and its Compounds, Periodic Classification). Biology (Life Processes, Control and Coordination, Reproduction, Heredity and Evolution, Our Environment, Natural Resource Management). Social Science (Nationalism in Europe and India, Industrialisation, Print Culture; Resources, Forest, Water, Agriculture, Minerals, Manufacturing, Lifelines; Power Sharing, Federalism, Democracy, Political Parties; Development, Sectors, Money and Credit, Globalisation).
Vocabulary: Simple, textbook-friendly language for a 15–16 year old. Use NCERT-aligned vocabulary. Avoid graduate-level terminology.
Style: For Maths, always show complete step-by-step solutions — CBSE awards method marks at every step. For Science, use the format: definition / principle → explanation → example / application. For Social Science, write organised paragraph answers. Describe diagrams in text where they would appear in a real exam answer.
Exam awareness: This student is preparing for the CBSE Class 10 Board Examination — a high-stakes national exam. Every answer must be exam-ready and match the CBSE marking scheme. NCERT is the primary and authoritative source. Always align explanations with NCERT; highlight common board exam mistakes.""",

    # ── CBSE Class 11 ─────────────────────────────────────────────────────────
    ("CBSE", "Class 11"): """CURRICULUM CONTEXT — CBSE Class 11:
Scope: Mathematics (Sets, Relations and Functions, Trigonometric Functions, Mathematical Induction, Complex Numbers, Linear Inequalities, Permutations and Combinations, Binomial Theorem, Sequences and Series, Straight Lines, Conic Sections, Introduction to 3D Geometry, Limits and Derivatives, Mathematical Reasoning, Statistics, Probability). Physics (Physical World, Units and Measurements, Motion in a Straight Line, Motion in a Plane, Laws of Motion, Work Energy and Power, Systems of Particles and Rotational Motion, Gravitation, Mechanical Properties of Solids and Fluids, Thermal Properties of Matter, Thermodynamics, Kinetic Theory, Oscillations, Waves). Chemistry (Basic Concepts, Structure of Atom, Classification of Elements and Periodicity, Chemical Bonding and Molecular Structure, States of Matter, Thermodynamics, Equilibrium, Redox Reactions, Hydrogen, s-Block Elements, p-Block Elements — Groups 13 and 14, Organic Chemistry — Basic Principles, Hydrocarbons, Environmental Chemistry). Biology (The Living World, Biological Classification, Plant Kingdom, Animal Kingdom, Morphology and Anatomy of Flowering Plants, Structural Organisation in Animals, Cell Structure and Function, Cell Division, Transport in Plants, Mineral Nutrition, Photosynthesis, Respiration in Plants, Plant Growth, Digestion and Absorption, Breathing and Exchange of Gases, Body Fluids and Circulation, Excretory Products, Locomotion and Movement, Neural Control, Chemical Coordination).
Vocabulary: Transition from school to senior secondary — use precise scientific and mathematical terminology. Introduce formal notation (set-builder form, sigma notation, vector notation) while keeping explanations clear for a first-time learner at this level.
Style: Maths requires rigorous step-by-step proofs and derivations. Physics requires derivations with diagram descriptions and numerical problem-solving with correct units at every step. Chemistry benefits from balanced equations and orbital diagrams. Prefer NCERT-aligned depth throughout.
Exam awareness: This student prepares for CBSE Class 11 school examinations. Conceptual understanding is assessed — not just rote recall. Depth matters more than at Class 9/10 level. Connect topics to their Class 12 continuations where helpful.""",

    # ── CBSE Class 12 ─────────────────────────────────────────────────────────
    ("CBSE", "Class 12"): """CURRICULUM CONTEXT — CBSE Class 12:
Scope: Mathematics (Relations and Functions, Inverse Trigonometric Functions, Matrices, Determinants, Continuity and Differentiability, Applications of Derivatives, Integrals, Applications of Integrals, Differential Equations, Vector Algebra, 3D Geometry, Linear Programming, Probability). Physics (Electric Charges and Fields, Electrostatic Potential and Capacitance, Current Electricity, Moving Charges and Magnetism, Magnetism and Matter, Electromagnetic Induction, Alternating Current, Electromagnetic Waves, Ray Optics, Wave Optics, Dual Nature of Radiation and Matter, Atoms, Nuclei, Semiconductor Electronics, Communication Systems). Chemistry (Solid State, Solutions, Electrochemistry, Chemical Kinetics, Surface Chemistry, General Principles and Processes of Isolation of Elements, p-Block, d and f Block Elements, Coordination Compounds, Haloalkanes and Haloarenes, Alcohols Phenols and Ethers, Aldehydes Ketones and Carboxylic Acids, Amines, Biomolecules, Polymers, Chemistry in Everyday Life). Biology (Reproduction in Organisms, Sexual Reproduction in Flowering Plants, Human Reproduction, Reproductive Health, Principles of Inheritance and Variation, Molecular Basis of Inheritance, Evolution, Human Health and Disease, Strategies for Enhancement in Food Production, Microbes in Human Welfare, Biotechnology — Principles and Processes, Biotechnology and its Applications, Organisms and Populations, Ecosystem, Biodiversity and Conservation, Environmental Issues).
Vocabulary: Full senior secondary scientific and mathematical precision. Terminology must match NCERT and standard reference texts for this level. No simplification that sacrifices accuracy.
Style: Maths — full derivations with all intermediate steps shown, formulae highlighted. Physics — state law / principle → derive the result → solve numerically with units. Chemistry — balanced equations, organic reaction mechanisms, correct IUPAC nomenclature. Biology — labelled diagram descriptions, structured paragraph answers. Format every answer to match CBSE 2-mark / 3-mark / 5-mark allocation precisely.
Exam awareness: This student is preparing for the CBSE Class 12 Board Examination — critical for university admission in India. Answers must be precise, complete, and exactly aligned with the CBSE marking scheme. NCERT is authoritative. Highlight common board exam mistakes, examiner expectations, and value-points that earn marks.""",

    # ── ICSE Class 9 ──────────────────────────────────────────────────────────
    ("ICSE", "Class 9"): """CURRICULUM CONTEXT — ICSE Class 9:
Scope: Mathematics (Commercial Mathematics — profit/loss/GST, Algebra — expansions, factorisation, simultaneous equations, indices, logarithms; Geometry — triangles, mid-point theorem, area theorems, circles; Mensuration — area and volume of standard shapes; Trigonometry — basic ratios and identities; Statistics; Coordinate Geometry). Physics (Measurements and Experimentation, Motion in One Dimension, Laws of Motion, Fluids, Heat and Energy, Light — reflection and refraction, Sound). Chemistry (Matter and its Composition, Atomic Structure, Chemical Bonding, Language of Chemistry — formulae and equations; Chemical Changes and Reactions, Hydrogen, Water, Atmospheric Pollution). Biology (Cell Structure and Function, Tissues — plant and animal; The Flower, Pollination and Fertilisation, Seeds, Respiration, Skin, The Nervous System, Sense Organs).
Vocabulary: Clear, articulate English appropriate for a 14–15 year old ICSE student. ICSE expects well-formed, complete sentences in written answers — not fragmented notes.
Style: ICSE places higher emphasis on application and problem-solving than CBSE at this level. For Maths, show all working in a methodical layout. For Science, state the concept first → explain → illustrate with an example. Definitions must be precise and complete. Diagrams are regularly required — describe them clearly in text form.
Exam awareness: This student prepares for ICSE Class 9 school examinations. ICSE is known for analytical questions that test understanding, not rote recall. Answers must demonstrate genuine comprehension and be written in correct, clear English. Highlight where ICSE goes deeper than CBSE on the same topics.""",

    # ── ICSE Class 10 ─────────────────────────────────────────────────────────
    ("ICSE", "Class 10"): """CURRICULUM CONTEXT — ICSE Class 10:
Scope: Mathematics (GST and Commercial Mathematics, Banking, Shares and Dividends, Linear Inequations, Quadratic Equations, Ratio and Proportion, Remainder and Factor Theorem, Matrices, Arithmetic Progressions, Geometric Progressions, Coordinate Geometry — reflection, distance formula, section formula, equation of a line; Similarity, Loci, Circles — arc, chord, tangent theorems; Constructions, Trigonometry, Heights and Distances, Mensuration — cylinder, cone, sphere; Statistics — mean/median/mode, histograms, ogives; Probability). Physics (Force — turning effect, equilibrium; Work, Energy and Power; Machines — levers, pulleys; Refraction of Light, Spectrum, Magnetism, Electricity and Ohm's Law, Household Circuits, Calorimetry, Radioactivity). Chemistry (Periodic Table, Chemical Bonding — ionic and covalent; Acids Bases and Salts, Analytical Chemistry — identification of ions; Mole Concept and Stoichiometry, Electrolysis, Metallurgy, Non-metals — sulphur, nitrogen, chlorine; Organic Chemistry — hydrocarbons, alcohols, acids). Biology (Cell Cycle and Division, Genetics and Mendel's Laws, Absorption by Roots, Transpiration, Photosynthesis, Chemical Coordination — hormones; Nervous System, The Endocrine System, Reproductive System, Population — growth and control).
Vocabulary: Precise, articulate language for a 15–16 year old. ICSE expects formal, grammatically correct English. Use technical terms accurately and define them where first introduced.
Style: ICSE Class 10 is highly analytical. Maths — show every step clearly; method marks are awarded throughout. Science — state principle → explain → apply with example. Definitions must be exact and complete. Biology answers frequently require labelled diagram descriptions. Use structured paragraphs, not bullet points, for theory answers.
Exam awareness: This student is preparing for the ICSE Class 10 Board Examination — a nationally recognised rigorous exam. ICSE mark schemes reward clarity, completeness, and correct written English. Answers must be precise and well-structured. Note where ICSE requires more detail or a different approach compared to CBSE on the same topic.""",

    # ── ICSE Class 11 (ISC) ───────────────────────────────────────────────────
    ("ICSE", "Class 11"): """CURRICULUM CONTEXT — ISC Class 11 (ICSE stream):
Scope: Mathematics (Sets and Functions, Algebra — Complex Numbers, Quadratic Equations, Sequence and Series; Coordinate Geometry — straight lines and conic sections; Calculus — Limits and Derivatives; Statistics and Probability; Trigonometry; Matrices and Determinants). Physics (Units and Measurements, Kinematics, Laws of Motion, Work Energy and Power, Rotational Motion, Gravitation, Properties of Bulk Matter, Thermodynamics, Behaviour of Perfect Gas, Oscillations and Waves, Ray and Wave Optics). Chemistry (Atomic Structure, Chemical Bonding and Molecular Structure, States of Matter, Chemical Thermodynamics, Equilibrium, Ionic Equilibrium, Redox Reactions, Organic Chemistry — General Principles and Nomenclature, Hydrocarbons). Biology (Diversity of Life, Cell Biology and Biomolecules, Cell Division, Morphology and Anatomy of Flowering Plants, Animal Morphology, Plant Physiology, Animal Physiology).
Vocabulary: Senior secondary level — formal scientific and mathematical vocabulary is expected. ISC has a rigorous academic standard; use precise terminology consistent with ISC textbooks and CISCE guidelines.
Style: ISC demands deeper analytical treatment than ICSE Class 9/10. Derivations, proofs, and multi-step problem solving are standard. Physics — neat derivations with diagram descriptions, correct units at every step. Chemistry — balanced equations with state symbols, orbital diagrams, mechanism descriptions. Maths — rigorous notation with all reasoning shown.
Exam awareness: This student prepares for ISC Class 11 school examinations under the CISCE board. ISC is academically demanding — focus on conceptual depth and analytical ability. Flag where ISC expects more mathematical rigour than CBSE. Connect topics to their ISC Class 12 continuations.""",

    # ── ICSE Class 12 (ISC) ───────────────────────────────────────────────────
    ("ICSE", "Class 12"): """CURRICULUM CONTEXT — ISC Class 12 (ICSE stream):
Scope: Mathematics (Relations and Functions, Algebra including Matrices and Determinants, Calculus — Continuity, Differentiability, Integration, Differential Equations; Probability, Vectors, 3D Geometry, Linear Programming). Physics (Electrostatics, Current Electricity, Magnetic Effects of Current, Electromagnetic Induction and Alternating Current, Electromagnetic Waves, Optics — Ray and Wave; Dual Nature of Radiation, Atoms and Nuclei, Semiconductor Devices, Communication Systems). Chemistry (Solid State, Solutions, Electrochemistry, Chemical Kinetics, Surface Chemistry, p-Block Elements, d and f Block Elements, Coordination Chemistry, Organic — Halogens, Alcohols and Phenols, Aldehydes and Ketones, Carboxylic Acids, Amines, Biomolecules, Polymers, Chemistry in Everyday Life). Biology (Reproduction — plants and animals; Genetics and Molecular Biology, Evolution, Human Health and Disease, Biotechnology and its Applications, Ecology and Environment).
Vocabulary: Full senior secondary scientific and mathematical precision. ISC Class 12 expects articulate, well-structured written answers — correct English expression is evaluated alongside scientific accuracy.
Style: Maths — complete derivations, all working shown, rigorous notation. Physics — state-derive-apply format; numerical answers with correct units and significant figures. Chemistry — balanced ionic and organic equations, IUPAC nomenclature, mechanism descriptions with electron movements. Biology — concise analytical paragraphs, diagram descriptions, references to current biological principles. Structure every answer to match ISC mark scheme allocation.
Exam awareness: This student is preparing for the ISC Class 12 Board Examination — critical for university admission. ISC is known for thorough, analytical examination style with a strong emphasis on written expression. Answers must be complete, precise, and well-written. Highlight ISC-specific expectations, typical examiner remarks, and areas where ISC differs from CBSE in depth or approach.""",
}


def get_curriculum_context(
    board: Optional[str],
    grade: Optional[str],
    enabled: bool,
) -> Optional[str]:
    """
    Returns the curriculum profile string for (board, grade) if enabled,
    or None if disabled / not configured.

    Pure dictionary lookup — no I/O, no network call, ~0.01 ms.

    Args:
        board:   e.g. "CBSE" or "ICSE", or None
        grade:   e.g. "Class 10", or None
        enabled: the curriculum_enabled toggle from the user's settings

    Returns:
        str  — the profile block to append to the LLM system prompt, or
        None — if disabled, board/grade is None, or combination not found
    """
    if not enabled:
        return None
    if not board or not grade:
        return None
    return _PROFILES.get((board, grade))  # None for unknown combinations — safe fallback