"""
X Client Module for the Nigeria Giveaway Bot
Handles all X (Twitter) API v2 interactions using Tweepy.

This module supports the 2-Phase Monitoring strategy:
- Phase 1: Broad search (crawling)
- Phase 2: Precise mentions, DMs, and thread monitoring

All methods include retry logic for rate limits and transient errors.
"""

import os
import tweepy
from typing import Optional, List, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential_jitter, retry_if_exception_type
from dotenv import load_dotenv
import logging

load_dotenv()

logger = logging.getLogger(__name__)


class XClient:
    """Wrapper around tweepy.Client for the giveaway bot."""

    def __init__(self):
        self.client = self._get_authenticated_client()
        self.bot_user_id: Optional[int] = None
        self.bot_username: Optional[str] = None

    def _get_authenticated_client(self) -> tweepy.Client:
        """Create authenticated Tweepy Client."""
        bearer_token = os.getenv("X_BEARER_TOKEN")
        api_key = os.getenv("X_API_KEY")
        api_secret = os.getenv("X_API_SECRET")
        access_token = os.getenv("X_ACCESS_TOKEN")
        access_token_secret = os.getenv("X_ACCESS_TOKEN_SECRET")

        if not all([bearer_token, api_key, api_secret, access_token, access_token_secret]):
            raise ValueError("Missing required X API credentials in environment variables")

        return tweepy.Client(
            bearer_token=bearer_token,
            consumer_key=api_key,
            consumer_secret=api_secret,
            access_token=access_token,
            access_token_secret=access_token_secret,
            wait_on_rate_limit=True,
        )

    # ============================================================
    # HELPER: Retry Decorator for X API Calls
    # ============================================================
    def _retry(self):
        """Returns a tenacity retry decorator tailored for X API."""
        return retry(
            stop=stop_after_attempt(5),
            wait=wait_exponential_jitter(initial=2, max=60),
            retry=retry_if_exception_type((
                tweepy.TooManyRequests,
                tweepy.TweepyException,
            )),
            reraise=True,
            before_sleep=lambda retry_state: logger.warning(
                f"Retrying X API call after error: {retry_state.outcome.exception()}"
            )
        )

    # ============================================================
    # BOT IDENTITY
    # ============================================================
    @_retry()
    def get_bot_identity(self) -> Dict[str, Any]:
        """Get and cache the bot's user ID and username."""
        if self.bot_user_id and self.bot_username:
            return {"user_id": self.bot_user_id, "username": self.bot_username}

        me = self.client.get_me(user_fields=["id", "username"])
        self.bot_user_id = me.data.id
        self.bot_username = me.data.username

        logger.info(f"Bot authenticated as @{self.bot_username} (ID: {self.bot_user_id})")
        return {"user_id": self.bot_user_id, "username": self.bot_username}

    # ============================================================
    # PHASE 1: BROAD SEARCH / CRAWLING
    # ============================================================
    @_retry()
    def search_recent_tweets(
        self,
        query: str,
        max_results: int = 50,
        since_id: Optional[str] = None,
        tweet_fields: Optional[List[str]] = None,
        expansions: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Phase 1 - Broad crawling for giveaway commands and activity.
        """
        default_fields = ["created_at", "author_id", "conversation_id", "text"]
        default_expansions = ["author_id"]

        tweets = self.client.search_recent_tweets(
            query=query,
            max_results=max_results,
            since_id=since_id,
            tweet_fields=tweet_fields or default_fields,
            expansions=expansions or default_expansions,
        )

        results = []
        if tweets.data:
            for tweet in tweets.data:
                results.append({
                    "id": str(tweet.id),
                    "text": tweet.text,
                    "author_id": str(tweet.author_id),
                    "conversation_id": str(getattr(tweet, "conversation_id", tweet.id)),
                    "created_at": tweet.created_at,
                })
        return results

    # ============================================================
    # PHASE 2: PRECISE MENTIONS
    # ============================================================
    @_retry()
    def get_user_mentions(
        self,
        user_id: Optional[int] = None,
        max_results: int = 50,
        since_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Phase 2 - Get recent mentions to the bot (primary for host commands).
        """
        if user_id is None:
            identity = self.get_bot_identity()
            user_id = identity["user_id"]

        mentions = self.client.get_users_mentions(
            id=user_id,
            max_results=max_results,
            since_id=since_id,
            tweet_fields=["created_at", "author_id", "conversation_id", "text"],
            expansions=["author_id"],
        )

        results = []
        if mentions.data:
            for tweet in mentions.data:
                results.append({
                    "id": str(tweet.id),
                    "text": tweet.text,
                    "author_id": str(tweet.author_id),
                    "conversation_id": str(getattr(tweet, "conversation_id", tweet.id)),
                    "created_at": tweet.created_at,
                })
        return results

    # ============================================================
    # THREAD / GIVEAWAY ENTRY COLLECTION
    # ============================================================
    @_retry()
    def get_thread_replies(
        self,
        conversation_id: str,
        max_results: int = 100,
        since_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Used to collect participant entries from a specific giveaway thread.
        """
        query = f"conversation_id:{conversation_id}"

        replies = self.client.search_recent_tweets(
            query=query,
            max_results=max_results,
            since_id=since_id,
            tweet_fields=["created_at", "author_id", "text"],
            expansions=["author_id"],
        )

        results = []
        if replies.data:
            for tweet in replies.data:
                results.append({
                    "id": str(tweet.id),
                    "text": tweet.text,
                    "author_id": str(tweet.author_id),
                    "created_at": tweet.created_at,
                })
        return results

    # ============================================================
    # POSTING (REPLIES)
    # ============================================================
    @_retry()
    def create_reply(
        self,
        text: str,
        in_reply_to_tweet_id: str,
        quote_tweet_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Post a reply in a thread (used for confirmations, announcements, etc.).
        """
        try:
            response = self.client.create_tweet(
                text=text,
                in_reply_to_tweet_id=in_reply_to_tweet_id,
                quote_tweet_id=quote_tweet_id,
                user_auth=True,   # Required for write actions
            )
            new_tweet_id = response.data.get("id")
            logger.info(f"Posted reply. New Tweet ID: {new_tweet_id}")
            return new_tweet_id
        except tweepy.TweepyException as e:
            logger.error(f"Failed to create reply: {e}")
            return None

    # ============================================================
    # DIRECT MESSAGES
    # ============================================================
    @_retry()
    def send_direct_message(self, user_id: str, text: str) -> bool:
        """
        Send a DM (used for winner notifications and bank detail collection).
        Note: User must allow DMs from the bot.
        """
        try:
            self.client.create_direct_message(
                participant_id=user_id,
                text=text
            )
            logger.info(f"DM sent to user {user_id}")
            return True
        except tweepy.TweepyException as e:
            logger.warning(f"Failed to send DM to {user_id}: {e}")
            return False

    # ============================================================
    # UTILITY: Get User Info (for KYC / trust scoring later)
    # ============================================================
    @_retry()
    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Fetch basic user information."""
        try:
            user = self.client.get_user(
                id=user_id,
                user_fields=["created_at", "public_metrics", "verified"]
            )
            if user.data:
                return {
                    "id": str(user.data.id),
                    "username": user.data.username,
                    "created_at": user.data.created_at,
                    "followers_count": user.data.public_metrics.get("followers_count", 0),
                    "verified": user.data.verified,
                }
        except tweepy.TweepyException as e:
            logger.error(f"Failed to fetch user {user_id}: {e}")
        return None


# Singleton instance for easy import
x_client = XClient()


# ============================================================
# Convenience Functions (for quick use in handlers/jobs)
# ============================================================

def search_for_commands(since_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Phase 1 convenience wrapper"""
    query = f"@{x_client.get_bot_identity()['username']} (giveaway OR start OR begin)"
    return x_client.search_recent_tweets(query=query, since_id=since_id)


def get_bot_mentions(since_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Phase 2 convenience wrapper"""
    return x_client.get_user_mentions(since_id=since_id)


if __name__ == "__main__":
    # Quick test
    print("Testing X Client authentication...")
    identity = x_client.get_bot_identity()
    print(f"Successfully authenticated as @{identity['username']}")