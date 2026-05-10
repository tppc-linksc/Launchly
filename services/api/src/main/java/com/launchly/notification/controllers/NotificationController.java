package com.launchly.notification.controllers;

import com.launchly.common.security.AuthContext;
import com.launchly.notification.entities.Notification;
import com.launchly.notification.services.NotificationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping
    public ResponseEntity<List<Notification>> list() {
        return ResponseEntity.ok(notificationService.listByUser(AuthContext.userId()));
    }

    @GetMapping("/unread-count")
    public ResponseEntity<Map<String, Long>> unreadCount() {
        return ResponseEntity.ok(Map.of("count", notificationService.unreadCount(AuthContext.userId())));
    }

    @PutMapping("/{id}/read")
    public ResponseEntity<Void> markRead(@PathVariable String id) {
        notificationService.markAsRead(id);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/read-all")
    public ResponseEntity<Void> markAllRead() {
        notificationService.markAllAsRead(AuthContext.userId());
        return ResponseEntity.ok().build();
    }
}
