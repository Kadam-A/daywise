/**
 * User Stats Screen — Redesigned
 *
 * Free: Summary cards + weekly progress + blurred pro preview + upgrade CTA
 * Pro: Summary cards with trends + period tabs + completion trend +
 *      peak hours + best days + insights + scheduling breakdown
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Dimensions } from 'react-native';
import { Text, ActivityIndicator, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';

import { useSubscription } from '@/contexts/SubscriptionContext';
import {
  getUserStats,
  getProductivityByHour,
  getProductivityByWeekday,
  getDailyCompletions,
  getMostProductiveHour,
  getMostProductiveDay,
  getSchedulingRatio,
  generateProductivityInsight,
} from '@/lib/user-stats';
import { UserStats, HourlyProductivity, WeekdayProductivity, DailyCompletion } from '@/lib/types';
import { useAppColors } from '@/contexts/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Period = 'week' | 'month';

export default function StatsScreen() {
  const appColors = useAppColors();
  const { isPro } = useSubscription();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyProductivity[]>([]);
  const [weekdayData, setWeekdayData] = useState<WeekdayProductivity[]>([]);
  const [dailyData, setDailyData] = useState<DailyCompletion[]>([]);
  const [period, setPeriod] = useState<Period>('week');
  const [isLoading, setIsLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(false);

  const loadStats = async () => {
    try {
      setIsLoading(true);
      const userStats = await getUserStats();
      setStats(userStats);

      if (isPro && userStats) {
        const days = period === 'week' ? 7 : 30;
        const [hourly, weekday, daily] = await Promise.all([
          getProductivityByHour(),
          getProductivityByWeekday(),
          getDailyCompletions(days),
        ]);
        setHourlyData(hourly);
        setWeekdayData(weekday);
        setDailyData(daily);
      }
    } catch (error) {
      console.error('[Stats] Error loading stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Reload when period changes (pro only)
  const loadTrendData = async () => {
    if (!isPro) return;
    setTrendLoading(true);
    const days = period === 'week' ? 7 : 30;
    const daily = await getDailyCompletions(days);
    setDailyData(daily);
    setTrendLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [isPro])
  );

  // Reload trend when period tab changes
  React.useEffect(() => {
    if (isPro && stats) {
      loadTrendData();
    }
  }, [period]);

  const insights = stats && isPro
    ? generateProductivityInsight(hourlyData, weekdayData, stats)
    : [];

  const schedulingRatio = stats ? getSchedulingRatio(stats) : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: appColors.surface, borderBottomColor: appColors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={appColors.textPrimary} />
        </Pressable>
        <Text variant="headlineSmall" style={[styles.headerTitle, { color: appColors.textPrimary }]}>
          Your Stats
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={appColors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* ===== SUMMARY CARDS ROW (Free + Pro) ===== */}
          <View style={styles.summaryRow}>
            <SummaryCard
              icon="check-circle-outline"
              value={stats?.tasks_completed_today || 0}
              label="Today"
              color={appColors.success}
              trend={isPro ? getTrend(stats?.tasks_completed_today, stats?.tasks_completed_yesterday) : undefined}
              trendLabel={isPro ? 'vs yesterday' : undefined}
            />
            <SummaryCard
              icon="fire"
              value={stats?.current_streak || 0}
              label="Streak"
              color={appColors.warning}
              sublabel={isPro && stats?.best_streak ? `Best: ${stats.best_streak}` : undefined}
            />
            <SummaryCard
              icon="checkbox-marked-circle-outline"
              value={isPro ? (stats?.tasks_completed_month || 0) : (stats?.total_completed || 0)}
              label={isPro ? 'This Month' : 'Total'}
              color={appColors.secondary}
              trend={isPro ? getTrend(stats?.tasks_completed_month, stats?.tasks_completed_last_month) : undefined}
              trendLabel={isPro ? 'vs last' : undefined}
            />
          </View>

          {/* ===== THIS WEEK PROGRESS (Free + Pro) ===== */}
          <View style={styles.section}>
            <WeekProgressCard stats={stats} />
          </View>

          {isPro ? (
            <>
              {/* ===== PERIOD TABS (Pro) ===== */}
              <View style={styles.periodTabs}>
                <Pressable
                  style={[
                    styles.periodTab,
                    period === 'week' && { backgroundColor: appColors.primary },
                  ]}
                  onPress={() => setPeriod('week')}
                >
                  <Text style={[
                    styles.periodTabText,
                    { color: period === 'week' ? '#FFFFFF' : appColors.textSecondary },
                  ]}>Week</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.periodTab,
                    period === 'month' && { backgroundColor: appColors.primary },
                  ]}
                  onPress={() => setPeriod('month')}
                >
                  <Text style={[
                    styles.periodTabText,
                    { color: period === 'month' ? '#FFFFFF' : appColors.textSecondary },
                  ]}>Month</Text>
                </Pressable>
              </View>

              {/* ===== COMPLETION TREND (Pro) ===== */}
              <View style={styles.section}>
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: appColors.textPrimary }]}>
                  Completion Trend
                </Text>
                <Surface style={[styles.chartCard, { backgroundColor: appColors.surface, minHeight: 160 }]} elevation={1}>
                  {trendLoading ? (
                    <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}>
                      <ActivityIndicator size="small" color={appColors.primary} />
                    </View>
                  ) : (
                    <>
                      <CompletionTrendChart data={dailyData} period={period} />
                      <TrendInsight data={dailyData} period={period} />
                    </>
                  )}
                </Surface>
              </View>

              {/* ===== PEAK HOURS (Pro) ===== */}
              {hourlyData.some(h => h.count > 0) && (
                <View style={styles.section}>
                  <Text variant="titleMedium" style={[styles.sectionTitle, { color: appColors.textPrimary }]}>
                    Peak Hours
                  </Text>
                  <Surface style={[styles.chartCard, { backgroundColor: appColors.surface }]} elevation={1}>
                    <PeakHoursChart data={hourlyData} />
                    {getMostProductiveHour(hourlyData) && (
                      <Text style={[styles.chartInsight, { color: appColors.textSecondary }]}>
                        You're most productive at {getMostProductiveHour(hourlyData)?.formatted}
                      </Text>
                    )}
                  </Surface>
                </View>
              )}

              {/* ===== BEST DAYS (Pro) ===== */}
              {weekdayData.some(d => d.count > 0) && (
                <View style={styles.section}>
                  <Text variant="titleMedium" style={[styles.sectionTitle, { color: appColors.textPrimary }]}>
                    Best Days
                  </Text>
                  <Surface style={[styles.chartCard, { backgroundColor: appColors.surface }]} elevation={1}>
                    <BestDaysChart data={weekdayData} />
                    {getMostProductiveDay(weekdayData) && (
                      <Text style={[styles.chartInsight, { color: appColors.textSecondary }]}>
                        {getMostProductiveDay(weekdayData)?.day_name}s are your strongest day
                      </Text>
                    )}
                  </Surface>
                </View>
              )}

              {/* ===== INSIGHTS (Pro) ===== */}
              <View style={styles.section}>
                <Text variant="titleMedium" style={[styles.sectionTitle, { color: appColors.textPrimary }]}>
                  Insights
                </Text>
                <Surface style={[styles.insightsCard, { backgroundColor: appColors.surface }]} elevation={1}>
                  {insights.length > 0 ? (
                    insights.map((insight, index) => (
                      <View key={index} style={styles.insightRow}>
                        <MaterialCommunityIcons
                          name="lightbulb-outline"
                          size={18}
                          color={appColors.secondary}
                        />
                        <Text style={[styles.insightText, { color: appColors.textSecondary }]}>{insight}</Text>
                      </View>
                    ))
                  ) : (
                    <View style={styles.insightRow}>
                      <MaterialCommunityIcons
                        name="lightbulb-outline"
                        size={18}
                        color={appColors.textTertiary}
                      />
                      <Text style={[styles.insightText, { color: appColors.textTertiary }]}>
                        Complete more tasks to unlock personalized insights
                      </Text>
                    </View>
                  )}
                </Surface>
              </View>

              {/* ===== SCHEDULING BREAKDOWN (Pro) ===== */}
              {schedulingRatio && schedulingRatio.totalScheduled > 0 && (
                <View style={styles.section}>
                  <Text variant="titleMedium" style={[styles.sectionTitle, { color: appColors.textPrimary }]}>
                    Scheduling Breakdown
                  </Text>
                  <Surface style={[styles.chartCard, { backgroundColor: appColors.surface }]} elevation={1}>
                    <SchedulingRatioBar ratio={schedulingRatio} />
                  </Surface>
                </View>
              )}
            </>
          ) : (
            /* ===== FREE: Blurred Pro Preview + Upgrade CTA ===== */
            <>
              <BlurredProSection title="Completion Trend" icon="chart-line" />
              <BlurredProSection title="Peak Hours" icon="clock-outline" />
              <BlurredProSection title="Best Days" icon="calendar-star" />

              <View style={styles.section}>
                <Pressable
                  style={styles.upgradeCard}
                  onPress={() => router.push({ pathname: '/paywall', params: { source: 'stats' } })}
                >
                  <LinearGradient
                    colors={[appColors.gradientStart, appColors.gradientEnd]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.upgradeGradient}
                  >
                    <MaterialCommunityIcons name="chart-areaspline" size={32} color="#FFFFFF" />
                    <Text style={styles.upgradeTitle}>
                      Unlock Advanced Analytics
                    </Text>
                    <Text style={styles.upgradeDescription}>
                      Completion trends, peak hours, best days, and personalized productivity insights
                    </Text>
                    <View style={styles.upgradeButton}>
                      <Text style={[styles.upgradeButtonText, { color: appColors.primary }]}>Upgrade to Pro</Text>
                      <MaterialCommunityIcons name="arrow-right" size={18} color={appColors.primary} />
                    </View>
                  </LinearGradient>
                </Pressable>
              </View>
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ============================================================
// HELPER: trend direction
// ============================================================
function getTrend(current?: number, previous?: number): 'up' | 'down' | 'neutral' | undefined {
  if (current === undefined || previous === undefined) return undefined;
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'neutral';
}

// ============================================================
// SUMMARY CARD (compact, 3-across)
// ============================================================
function SummaryCard({
  icon,
  value,
  label,
  color,
  sublabel,
  trend,
  trendLabel,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  value: number;
  label: string;
  color: string;
  sublabel?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
}) {
  const appColors = useAppColors();

  return (
    <Surface style={[styles.summaryCard, { backgroundColor: appColors.surface }]} elevation={1}>
      <View style={[styles.summaryIconWrap, { backgroundColor: `${color}15` }]}>
        <MaterialCommunityIcons name={icon} size={20} color={color} />
      </View>
      <Text style={[styles.summaryValue, { color: appColors.textPrimary }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: appColors.textSecondary }]}>{label}</Text>
      {sublabel && (
        <Text style={[styles.summarySublabel, { color: appColors.textTertiary }]}>{sublabel}</Text>
      )}
      {trend && trend !== 'neutral' && (
        <View style={styles.summaryTrend}>
          <MaterialCommunityIcons
            name={trend === 'up' ? 'arrow-up' : 'arrow-down'}
            size={12}
            color={trend === 'up' ? appColors.success : appColors.warning}
          />
          {trendLabel && (
            <Text style={[styles.summaryTrendText, {
              color: trend === 'up' ? appColors.success : appColors.warning,
            }]}>{trendLabel}</Text>
          )}
        </View>
      )}
    </Surface>
  );
}

// ============================================================
// WEEK PROGRESS CARD
// ============================================================
function WeekProgressCard({ stats }: { stats: UserStats | null }) {
  const appColors = useAppColors();
  const completed = stats?.tasks_completed_week || 0;
  const total = Math.max(stats?.tasks_total_week || 0, completed); // never show completed > total
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Surface style={[styles.weekCard, { backgroundColor: appColors.surface }]} elevation={1}>
      <View style={styles.weekHeader}>
        <Text style={[styles.weekTitle, { color: appColors.textPrimary }]}>This Week</Text>
        <Text style={[styles.weekPct, { color: appColors.primary }]}>{pct}%</Text>
      </View>
      <Text style={[styles.weekCount, { color: appColors.textSecondary }]}>
        {completed} of {total} tasks completed
      </Text>
      <View style={[styles.progressTrack, { backgroundColor: `${appColors.primary}20` }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.min(pct, 100)}%`, backgroundColor: appColors.primary },
          ]}
        />
      </View>
    </Surface>
  );
}

// ============================================================
// COMPLETION TREND CHART (Pro)
// ============================================================
function CompletionTrendChart({ data, period }: { data: DailyCompletion[]; period: Period }) {
  const appColors = useAppColors();
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const isMonth = period === 'month';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const getLabel = (dateStr: string, index: number) => {
    const date = new Date(dateStr + 'T12:00:00');
    if (!isMonth) {
      return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
    }
    // Month: label only on Mondays (day 1) or first/last bar
    if (index === 0 || date.getDay() === 1) {
      return `${date.getDate()}`;
    }
    return '';
  };

  return (
    <View style={chartStyles.container}>
      {/* Month axis label */}
      {isMonth && data.length > 0 && (
        <Text style={[chartStyles.monthLabel, { color: appColors.textTertiary }]}>
          {months[new Date(data[0].date + 'T12:00:00').getMonth()]}
        </Text>
      )}
      <View style={[chartStyles.barsContainer, { height: 120 }]}>
        {data.map((item, index) => {
          const heightPct = (item.count / maxCount) * 100;
          const date = new Date(item.date + 'T12:00:00');
          const isMonday = date.getDay() === 1;
          return (
            <View
              key={item.date}
              style={[
                isMonth ? chartStyles.monthBarColumn : chartStyles.dayBarColumn,
                isMonth && isMonday && { marginLeft: 3 },
              ]}
            >
              <View style={[chartStyles.barWrapper, { height: 100 }]}>
                <View
                  style={[
                    chartStyles.bar,
                    {
                      height: `${Math.max(heightPct, 3)}%`,
                      backgroundColor: item.count > 0 ? appColors.primary : `${appColors.primary}30`,
                      opacity: item.count > 0 ? 0.5 + (item.count / maxCount) * 0.5 : 0.3,
                    },
                  ]}
                />
              </View>
              <Text style={[chartStyles.barLabel, { color: appColors.textTertiary }]}>
                {getLabel(item.date, index)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TrendInsight({ data, period }: { data: DailyCompletion[]; period: Period }) {
  const appColors = useAppColors();
  if (!data.length) return null;

  const totalCount = data.reduce((sum, d) => sum + d.count, 0);
  const avg = (totalCount / data.length).toFixed(1);

  const bestDay = data.reduce((best, d) => d.count > best.count ? d : best, data[0]);
  const bestDate = new Date(bestDay.date + 'T12:00:00');

  if (period === 'month') {
    const avgPerDay = (totalCount / data.length).toFixed(1);
    const bestLabel = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][bestDate.getDay()]} ${bestDate.getDate()}`;
    return (
      <Text style={[styles.chartInsight, { color: appColors.textSecondary }]}>
        Avg: {avgPerDay}/day{bestDay.count > 0 ? ` · Best: ${bestLabel} (${bestDay.count})` : ''}
      </Text>
    );
  }

  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][bestDate.getDay()];

  return (
    <Text style={[styles.chartInsight, { color: appColors.textSecondary }]}>
      Avg: {avg} tasks/day{bestDay.count > 0 ? ` · Best: ${dayName} (${bestDay.count})` : ''}
    </Text>
  );
}

// ============================================================
// PEAK HOURS CHART (Pro — polished)
// ============================================================
function PeakHoursChart({ data }: { data: HourlyProductivity[] }) {
  const appColors = useAppColors();
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const filteredData = data.filter(d => d.hour >= 6 && d.hour <= 22);
  const peakHour = data.reduce((max, h) => h.count > max.count ? h : max, data[0]).hour;

  return (
    <View style={chartStyles.container}>
      <View style={[chartStyles.barsContainer, { height: 120 }]}>
        {filteredData.map((item) => {
          const isPeak = item.hour === peakHour && item.count > 0;
          return (
            <View key={item.hour} style={chartStyles.barColumn}>
              <View style={[chartStyles.barWrapper, { height: 100 }]}>
                <View
                  style={[
                    chartStyles.bar,
                    {
                      height: `${Math.max((item.count / maxCount) * 100, 3)}%`,
                      backgroundColor: isPeak ? appColors.secondary : appColors.primary,
                      opacity: item.count > 0 ? (isPeak ? 1 : 0.5 + (item.count / maxCount) * 0.5) : 0.2,
                    },
                  ]}
                />
              </View>
              <Text style={[chartStyles.barLabel, { color: appColors.textTertiary }]}>
                {item.hour % 3 === 0 ? (item.hour === 0 ? '12a' : item.hour < 12 ? `${item.hour}a` : item.hour === 12 ? '12p' : `${item.hour - 12}p`) : ''}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ============================================================
// BEST DAYS CHART (Pro — polished)
// ============================================================
function BestDaysChart({ data }: { data: WeekdayProductivity[] }) {
  const appColors = useAppColors();
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const peakDay = data.reduce((max, d) => d.count > max.count ? d : max, data[0]).day;

  return (
    <View style={chartStyles.container}>
      <View style={[chartStyles.barsContainer, { height: 120 }]}>
        {data.map((item) => {
          const isPeak = item.day === peakDay && item.count > 0;
          return (
            <View key={item.day} style={chartStyles.dayBarColumn}>
              <View style={[chartStyles.barWrapper, { height: 100 }]}>
                <View
                  style={[
                    chartStyles.bar,
                    {
                      height: `${Math.max((item.count / maxCount) * 100, 3)}%`,
                      backgroundColor: isPeak ? appColors.secondary : appColors.primary,
                      opacity: item.count > 0 ? (isPeak ? 1 : 0.5 + (item.count / maxCount) * 0.5) : 0.2,
                    },
                  ]}
                />
              </View>
              <Text style={[chartStyles.barLabel, { color: appColors.textTertiary }]}>{item.day_name}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ============================================================
// SCHEDULING RATIO BAR (Pro)
// ============================================================
function SchedulingRatioBar({ ratio }: { ratio: { smartPercent: number; manualPercent: number; totalScheduled: number } }) {
  const appColors = useAppColors();

  return (
    <View>
      <View style={styles.ratioLabels}>
        <Text style={[styles.ratioLabel, { color: appColors.secondary }]}>
          {ratio.smartPercent}% AI
        </Text>
        <Text style={[styles.ratioLabel, { color: appColors.primary }]}>
          {ratio.manualPercent}% Manual
        </Text>
      </View>
      <View style={[styles.ratioTrack, { backgroundColor: appColors.border }]}>
        <View
          style={[
            styles.ratioFillLeft,
            {
              width: `${ratio.smartPercent}%`,
              backgroundColor: appColors.secondary,
            },
          ]}
        />
        <View
          style={[
            styles.ratioFillRight,
            {
              width: `${ratio.manualPercent}%`,
              backgroundColor: appColors.primary,
            },
          ]}
        />
      </View>
      <View style={styles.ratioCounts}>
        <View style={styles.ratioCountItem}>
          <MaterialCommunityIcons name="brain" size={14} color={appColors.secondary} />
          <Text style={[styles.ratioCountText, { color: appColors.textSecondary }]}>
            {Math.round(ratio.totalScheduled * ratio.smartPercent / 100)} tasks
          </Text>
        </View>
        <View style={styles.ratioCountItem}>
          <MaterialCommunityIcons name="gesture-tap" size={14} color={appColors.primary} />
          <Text style={[styles.ratioCountText, { color: appColors.textSecondary }]}>
            {Math.round(ratio.totalScheduled * ratio.manualPercent / 100)} tasks
          </Text>
        </View>
      </View>
    </View>
  );
}

// ============================================================
// BLURRED PRO SECTION (Free users)
// ============================================================
function BlurredProSection({ title, icon }: { title: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }) {
  const appColors = useAppColors();

  // Placeholder bar data
  const placeholderBars = [3, 5, 2, 7, 4, 6, 3];

  return (
    <View style={styles.section}>
      <Text variant="titleMedium" style={[styles.sectionTitle, { color: appColors.textPrimary }]}>
        {title}
      </Text>
      <Surface style={[styles.chartCard, { backgroundColor: appColors.surface, overflow: 'hidden' }]} elevation={1}>
        {/* Placeholder chart (blurred) */}
        <View style={{ opacity: 0.15 }}>
          <View style={[chartStyles.barsContainer, { height: 80 }]}>
            {placeholderBars.map((h, i) => (
              <View key={i} style={chartStyles.dayBarColumn}>
                <View style={[chartStyles.barWrapper, { height: 60 }]}>
                  <View
                    style={[
                      chartStyles.bar,
                      {
                        height: `${(h / 7) * 100}%`,
                        backgroundColor: appColors.primary,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Lock overlay */}
        <View style={[StyleSheet.absoluteFill, styles.lockOverlay]}>
          <View style={[styles.lockBadge, { backgroundColor: `${appColors.textSecondary}18` }]}>
            <MaterialCommunityIcons name={icon} size={20} color={appColors.textSecondary} />
            <MaterialCommunityIcons name="lock" size={14} color={appColors.textSecondary} style={{ marginLeft: 4 }} />
          </View>
          <Text style={[styles.lockText, { color: appColors.textSecondary }]}>Pro Feature</Text>
        </View>
      </Surface>
    </View>
  );
}

// ============================================================
// CHART STYLES
// ============================================================
const chartStyles = StyleSheet.create({
  container: {
    paddingTop: 8,
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 1,
  },
  dayBarColumn: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  monthBarColumn: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 0.5,
  },
  monthLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 4,
    marginLeft: 4,
  },
  barWrapper: {
    width: '80%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    minHeight: 3,
  },
  barLabel: {
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
    width: 24,
  },
});

// ============================================================
// MAIN STYLES
// ============================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '600',
  },
  headerSpacer: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontWeight: '600',
    marginBottom: 10,
  },

  // Summary cards row
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  summaryLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  summarySublabel: {
    fontSize: 9,
    marginTop: 2,
  },
  summaryTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 2,
  },
  summaryTrendText: {
    fontSize: 9,
    fontWeight: '500',
  },

  // Week progress card
  weekCard: {
    borderRadius: 16,
    padding: 16,
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  weekTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  weekPct: {
    fontSize: 15,
    fontWeight: '700',
  },
  weekCount: {
    fontSize: 13,
    marginBottom: 10,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },

  // Period tabs
  periodTabs: {
    flexDirection: 'row',
    alignSelf: 'center',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 20,
    gap: 4,
  },
  periodTab: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 10,
  },
  periodTabText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Chart card
  chartCard: {
    borderRadius: 16,
    padding: 16,
  },
  chartInsight: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
    fontWeight: '500',
  },

  // Insights
  insightsCard: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  insightText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },

  // Scheduling ratio
  ratioLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  ratioLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  ratioTrack: {
    height: 12,
    borderRadius: 6,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  ratioFillLeft: {
    height: '100%',
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  ratioFillRight: {
    height: '100%',
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  ratioCounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  ratioCountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratioCountText: {
    fontSize: 12,
  },

  // Lock overlay (blurred pro sections)
  lockOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 4,
  },
  lockText: {
    fontSize: 11,
    fontWeight: '500',
  },

  // Upgrade CTA
  upgradeCard: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  upgradeGradient: {
    padding: 24,
    alignItems: 'center',
  },
  upgradeTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  upgradeDescription: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  upgradeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  upgradeButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
