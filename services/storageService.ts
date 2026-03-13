import { ExamSession, UserProfile } from '../types';
import { db, auth, doc, getDoc, setDoc, collection, query, where, getDocs, addDoc, orderBy, serverTimestamp } from '../src/firebase';

export const saveExamToFirestore = async (session: ExamSession): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário não autenticado');

  const examData = {
    ...session,
    userId: user.uid,
    date: new Date().toISOString(),
    timestamp: serverTimestamp()
  };

  // Save the exam
  await setDoc(doc(db, 'exams', session.id), examData);

  // Update user statistics
  await updateUserStats(user.uid, session.score, session.questions.length);
};

const updateUserStats = async (userId: string, lastScore: number, totalQuestions: number) => {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  
  const scorePercentage = (lastScore / totalQuestions) * 100;

  if (userSnap.exists()) {
    const data = userSnap.data() as UserProfile;
    const newTotalExams = (data.totalExams || 0) + 1;
    const newAverageScore = ((data.averageScore || 0) * (data.totalExams || 0) + scorePercentage) / newTotalExams;

    await setDoc(userRef, {
      ...data,
      totalExams: newTotalExams,
      averageScore: newAverageScore,
      lastExamDate: new Date().toISOString()
    }, { merge: true });
  } else {
    // Should have been created at login, but fallback
    await setDoc(userRef, {
      uid: userId,
      email: auth.currentUser?.email || '',
      displayName: auth.currentUser?.displayName || '',
      photoURL: auth.currentUser?.photoURL || '',
      totalExams: 1,
      averageScore: scorePercentage,
      lastExamDate: new Date().toISOString()
    }, { merge: true });
  }
};

export const getUserExams = async (): Promise<ExamSession[]> => {
  const user = auth.currentUser;
  if (!user) return [];

  const q = query(
    collection(db, 'exams'),
    where('userId', '==', user.uid),
    orderBy('date', 'desc')
  );

  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc: any) => doc.data() as ExamSession);
};

export const deleteExamFromFirestore = async (id: string): Promise<void> => {
  // For simplicity, we'll just use setDoc with a deleted flag or skip for now
  // Real delete would require deleteDoc
};

export const getGlobalStats = async () => {
  const examsSnap = await getDocs(collection(db, 'exams'));
  const usersSnap = await getDocs(collection(db, 'users'));
  
  const totalExams = examsSnap.size;
  const totalUsers = usersSnap.size;
  
  let totalScore = 0;
  examsSnap.forEach((doc: any) => {
    const data = doc.data();
    totalScore += (data.score / data.questions.length) * 100;
  });

  const averageGlobalScore = totalExams > 0 ? totalScore / totalExams : 0;

  const topPerformers = usersSnap.docs
    .map((doc: any) => ({
      name: doc.data().displayName || 'Anônimo',
      score: Math.round(doc.data().averageScore || 0)
    }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5);

  return {
    totalUsers,
    totalExams,
    averageGlobalScore: Math.round(averageGlobalScore),
    topPerformers
  };
};

// Legacy support for local storage if needed, but we'll prefer Firestore
export const getAllSavedExams = getUserExams;
export const saveExamToLocal = saveExamToFirestore;
export const deleteExamFromLocal = deleteExamFromFirestore;
