/**
 * Academic Structure Data - Faculties, Departments, and Programmes
 * This file contains the institutional hierarchy for scheduling
 */

export interface Faculty {
  id: string;
  name: string;
  code: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  facultyId: string;
}

export interface Programme {
  id: string;
  name: string;
  code: string;
  departmentId: string;
  level: 'Bachelor' | 'Master' | 'PhD';
}

export const faculties: Faculty[] = [
  { id: 'eng', name: 'Engineering Science', code: 'ENG' },
  { id: 'sci', name: 'Science', code: 'SCI' },
  { id: 'arts', name: 'Arts and Humanities', code: 'ARTS' },
  { id: 'med', name: 'Medicine', code: 'MED' },
  { id: 'law', name: 'Law', code: 'LAW' },
  { id: 'econ', name: 'Economics and Business', code: 'ECON' },
];

export const departments: Department[] = [
  // Engineering Science
  { id: 'cs', name: 'Computer Science', code: 'CS', facultyId: 'eng' },
  { id: 'ee', name: 'Electrical Engineering', code: 'EE', facultyId: 'eng' },
  { id: 'me', name: 'Mechanical Engineering', code: 'ME', facultyId: 'eng' },
  { id: 'ce', name: 'Civil Engineering', code: 'CE', facultyId: 'eng' },
  { id: 'che', name: 'Chemical Engineering', code: 'CHE', facultyId: 'eng' },

  // Science
  { id: 'math', name: 'Mathematics', code: 'MATH', facultyId: 'sci' },
  { id: 'phys', name: 'Physics', code: 'PHYS', facultyId: 'sci' },
  { id: 'chem', name: 'Chemistry', code: 'CHEM', facultyId: 'sci' },
  { id: 'bio', name: 'Biology', code: 'BIO', facultyId: 'sci' },

  // Arts and Humanities
  { id: 'phil', name: 'Philosophy', code: 'PHIL', facultyId: 'arts' },
  { id: 'hist', name: 'History', code: 'HIST', facultyId: 'arts' },
  { id: 'ling', name: 'Linguistics', code: 'LING', facultyId: 'arts' },
];

export const programmes: Programme[] = [
  // Computer Science
  { id: 'cs-bach', name: 'Bachelor of Science in Computer Science', code: 'CS-B', departmentId: 'cs', level: 'Bachelor' },
  { id: 'cs-mast', name: 'Master of Science in Computer Science', code: 'CS-M', departmentId: 'cs', level: 'Master' },
  { id: 'ai-mast', name: 'Master of Artificial Intelligence', code: 'AI-M', departmentId: 'cs', level: 'Master' },
  { id: 'se-mast', name: 'Master of Software Engineering', code: 'SE-M', departmentId: 'cs', level: 'Master' },
  { id: 'ds-mast', name: 'Master of Data Science', code: 'DS-M', departmentId: 'cs', level: 'Master' },
  { id: 'cs-phd', name: 'PhD in Computer Science', code: 'CS-PhD', departmentId: 'cs', level: 'PhD' },

  // Electrical Engineering
  { id: 'ee-bach', name: 'Bachelor of Electrical Engineering', code: 'EE-B', departmentId: 'ee', level: 'Bachelor' },
  { id: 'ee-mast', name: 'Master of Electrical Engineering', code: 'EE-M', departmentId: 'ee', level: 'Master' },
  { id: 'ee-phd', name: 'PhD in Electrical Engineering', code: 'EE-PhD', departmentId: 'ee', level: 'PhD' },

  // Mechanical Engineering
  { id: 'me-bach', name: 'Bachelor of Mechanical Engineering', code: 'ME-B', departmentId: 'me', level: 'Bachelor' },
  { id: 'me-mast', name: 'Master of Mechanical Engineering', code: 'ME-M', departmentId: 'me', level: 'Master' },
  { id: 'me-phd', name: 'PhD in Mechanical Engineering', code: 'ME-PhD', departmentId: 'me', level: 'PhD' },

  // Civil Engineering
  { id: 'ce-bach', name: 'Bachelor of Civil Engineering', code: 'CE-B', departmentId: 'ce', level: 'Bachelor' },
  { id: 'ce-mast', name: 'Master of Civil Engineering', code: 'CE-M', departmentId: 'ce', level: 'Master' },

  // Chemical Engineering
  { id: 'che-bach', name: 'Bachelor of Chemical Engineering', code: 'CHE-B', departmentId: 'che', level: 'Bachelor' },
  { id: 'che-mast', name: 'Master of Chemical Engineering', code: 'CHE-M', departmentId: 'che', level: 'Master' },

  // Mathematics
  { id: 'math-bach', name: 'Bachelor of Mathematics', code: 'MATH-B', departmentId: 'math', level: 'Bachelor' },
  { id: 'math-mast', name: 'Master of Mathematics', code: 'MATH-M', departmentId: 'math', level: 'Master' },
  { id: 'math-phd', name: 'PhD in Mathematics', code: 'MATH-PhD', departmentId: 'math', level: 'PhD' },

  // Physics
  { id: 'phys-bach', name: 'Bachelor of Physics', code: 'PHYS-B', departmentId: 'phys', level: 'Bachelor' },
  { id: 'phys-mast', name: 'Master of Physics', code: 'PHYS-M', departmentId: 'phys', level: 'Master' },
  { id: 'phys-phd', name: 'PhD in Physics', code: 'PHYS-PhD', departmentId: 'phys', level: 'PhD' },

  // Chemistry
  { id: 'chem-bach', name: 'Bachelor of Chemistry', code: 'CHEM-B', departmentId: 'chem', level: 'Bachelor' },
  { id: 'chem-mast', name: 'Master of Chemistry', code: 'CHEM-M', departmentId: 'chem', level: 'Master' },

  // Biology
  { id: 'bio-bach', name: 'Bachelor of Biology', code: 'BIO-B', departmentId: 'bio', level: 'Bachelor' },
  { id: 'bio-mast', name: 'Master of Biology', code: 'BIO-M', departmentId: 'bio', level: 'Master' },
  { id: 'bio-phd', name: 'PhD in Biology', code: 'BIO-PhD', departmentId: 'bio', level: 'PhD' },

  // Philosophy
  { id: 'phil-bach', name: 'Bachelor of Philosophy', code: 'PHIL-B', departmentId: 'phil', level: 'Bachelor' },
  { id: 'phil-mast', name: 'Master of Philosophy', code: 'PHIL-M', departmentId: 'phil', level: 'Master' },

  // History
  { id: 'hist-bach', name: 'Bachelor of History', code: 'HIST-B', departmentId: 'hist', level: 'Bachelor' },
  { id: 'hist-mast', name: 'Master of History', code: 'HIST-M', departmentId: 'hist', level: 'Master' },

  // Linguistics
  { id: 'ling-bach', name: 'Bachelor of Linguistics', code: 'LING-B', departmentId: 'ling', level: 'Bachelor' },
  { id: 'ling-mast', name: 'Master of Linguistics', code: 'LING-M', departmentId: 'ling', level: 'Master' },
];

// Helper functions to get enriched data with relationships
export function getProgrammeWithDetails(programmeId: string) {
  const programme = programmes.find(p => p.id === programmeId);
  if (!programme) return null;

  const department = departments.find(d => d.id === programme.departmentId);
  if (!department) return null;

  const faculty = faculties.find(f => f.id === department.facultyId);
  if (!faculty) return null;

  return {
    ...programme,
    department,
    faculty,
  };
}

export function getProgrammesByDepartment(departmentId: string) {
  return programmes.filter(p => p.departmentId === departmentId);
}

export function getDepartmentsByFaculty(facultyId: string) {
  return departments.filter(d => d.facultyId === facultyId);
}

export function getAllProgrammesWithDetails() {
  return programmes.map(prog => {
    const department = departments.find(d => d.id === prog.departmentId);
    const faculty = department ? faculties.find(f => f.id === department.facultyId) : null;

    return {
      ...prog,
      departmentName: department?.name || '',
      departmentCode: department?.code || '',
      facultyName: faculty?.name || '',
      facultyCode: faculty?.code || '',
    };
  });
}
