import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Link } from 'expo-router';
import { useAppColors } from '@/contexts/ThemeContext';

export default function NotFoundScreen() {
  const appColors = useAppColors();
  return (
    <View style={[styles.container, { backgroundColor: appColors.background }]}>
      <Text style={[styles.title, { color: appColors.textPrimary }]}>Page not found</Text>
      <Link href="/(tabs)/home" style={{ color: appColors.primary }}>Go to home</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { fontSize: 20, fontWeight: '600' },
});
