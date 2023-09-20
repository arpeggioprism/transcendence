import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Channel } from './entity/channel.entity';
import { User } from 'src/user/entity/user.entity';
import { ChannelRepository } from './channel.repository';
import { MessageRepository } from './message.repository';
import { ChatGateway } from './chat.gateway';
import { UcbRepository } from './ucb.repository';
import { UserType } from './enum/user_type.enum';
import { MemberDto } from './dto/member-dto';
import { UserService } from 'src/user/user.service';
import { UserChannelBridge } from './entity/user-channel-bridge.entity';
import { AuthService } from 'src/auth/auth.service';
import { Message } from './entity/message.entity';
import * as bcrypt from 'bcrypt';
import { channel } from 'diagnostics_channel';
import { JoinChannelDto, GroupChannelDto } from './dto/channel-dto';
import { ChannelType } from './enum/channel_type.enum';
import { DmDto, GroupMessageDto } from './dto/message-dto';

@Injectable()
export class ChatService {
    constructor( private channelRepository: ChannelRepository,
        private messageRepository: MessageRepository,
        private ucbRepository: UcbRepository,
        private userService: UserService,
        private authService: AuthService) { }

    async createGroupChannel(user: User, groupChannelDto: GroupChannelDto): Promise<Channel> {
        // const duplicate = this.getChannelByName(groupChannelDto.channelName);
        // if (duplicate)
        //     throw new ConflictException(`channel ${groupChannelDto.channelName} already exists.`);
    
        const newChannel = await this.channelRepository.createGroupChannel(groupChannelDto);
        await this.createUCBridge(user, newChannel, UserType.OWNER);
        
        return newChannel;
    }

    async createDmChannel(sender: User, senderId: number, receiverId: number): Promise<Channel> {
        const newChannel = await this.channelRepository.createDmChannel(senderId, receiverId);
        const receiver = await this.userService.getProfileByUserId(receiverId);
        
        await this.createUCBridge(sender, newChannel, UserType.MEMBER);
        await this.createUCBridge(receiver, newChannel, UserType.MEMBER);
        
        return newChannel;
    }

    async createPrivateChannel(user: User, user_id: number, channelName: string): Promise<Channel> {
        const newChannel = await this.channelRepository.createPrivateChannel(channelName);
        await this.createUCBridge(user, newChannel, UserType.OWNER);

        return newChannel;
    }

    async createUCBridge(user: User, channel: Channel, userType: UserType) {
        await this.ucbRepository.createUCBridge(user, channel, userType);
    }

    //
    async getMembersByChannelId(channelId: number, userId: number): Promise<MemberDto[]> {
        let membersObject: MemberDto[] = [];

        if (await this.ucbRepository.getUcbByIds(userId, channelId)) {
            const usersId = await this.ucbRepository
            .createQueryBuilder('m')
            .where('m.channel_id = :channelId', {channelId})
            .select(['m.user_id', 'm.user_type'])
            .getMany();

            const members: User[] = [];
            for (let id of usersId) {
                let memberObject = {
                    member: await this.userService.getProfileByUserId(id.user_id),
                    type: id.user_type,
                    is_banned: id.is_banned,
                    is_muted: id.is_muted
                }
                membersObject.push(memberObject);
            }
        }
        return membersObject; 
    }

    async getJoinedGroupChannelsOfUser(userId: number) {
        const isBanned = false;
        const channelIds = await this.ucbRepository
        .createQueryBuilder('b')
        .where('b.user_id = :userId', {userId})
        .andWhere('b.is_banned = :isBanned', {isBanned})
        .select(['b.channel_id'])
        .getMany();

        let joinedChannels = [];
        for (let c of channelIds) {
            let tmp = await this.channelRepository.getChannelById(c.channel_id);
            if (tmp.channel_type === ChannelType.PUBLIC || tmp.channel_type === ChannelType.PROTECTED) {
                joinedChannels.push(tmp);
            }
        }

        return joinedChannels;
    }

    async getJoinedDmChannelsOfUser(userId: number) {
        const channels = await this.ucbRepository
        .createQueryBuilder('b')
        .where('b.user_id = :userId', {userId})
        .select(['b.channel_id'])
        .getMany();

        let joinedChannels = [];
        for (let c of channels) {
            let tmp = await this.channelRepository.getChannelById(c.channel_id);
            if (tmp.channel_type === ChannelType.DM) {
                joinedChannels.push(tmp);
            }
        }

        return joinedChannels;
    }

    async createGroupMessage(sender: User, channel: Channel, content: string): Promise<Message> {
        return await this.messageRepository.createGroupMessage(sender, channel, content);
    }

    async createDM(sender:User, channel: Channel, content: string): Promise<Message> {
        return await this.messageRepository.createDM(sender, channel, content);
    }

    async getMessagesByChannelId(channelId: number, userId: number): Promise<Message[]> {
        let messages: Message[] = [];
        if (await this.isMember(channelId, userId)) {
            const query = await this.messageRepository.createQueryBuilder('m')
            .select(['m.content', 'm.user_id', 'm.channel_id'])
            .where('m.channel_id = :channelId', {channelId})
            .orderBy('m.created_at');

            messages = await query.getMany();

            //block 유저의 메세지 지우는 부분 필요
        }
    
        return messages;
    }

    //
    async getAllRooms(userId: number): Promise<Channel[]> {
        const rooms = await this.channelRepository
        .createQueryBuilder('r')
        .select(['r.channel_id', 'r.channel_name', 'r.is_public', 'r.is_channel'])
        .getMany();

        let i = 0;
        while (i < rooms.length) {
            if ((rooms[i].is_public === false && await this.isMember(rooms[i].channel_id, userId)) || 
            (rooms[i].is_public === true && await this.isBanned(rooms[i].channel_id, userId))) {
                rooms.splice(i, 1);
            }
            else
                i++;
        }
        return rooms;
    }

    //
    async isMember(channelId: number, userId: number): Promise<UserChannelBridge> {
        return await this.ucbRepository.getUcbByIds(userId, channelId);
    }
    
    async isInThisChannel(userId: number, channelId: number): Promise<UserChannelBridge> {
        return await this.ucbRepository.getUcbByIds(userId, channelId);
    }

    async isBanned(channelId: number, userId: number): Promise<boolean> {
        const membership = await this.ucbRepository.getUcbByIds(userId, channelId);

        if (membership && membership.is_banned === true)
            return true;
        return false;
    }

    async deleteUCBridge(userId: number, channelId: number) {
        return await this.ucbRepository.deleteUCBridge(userId, channelId, );
    }

    async deleteChannelIfEmpty(channelId: number) {
        const channels = await this.ucbRepository
        .createQueryBuilder('b')
        .where('b.channel_id = :channelId', {channelId})
        .select(['b.channel_id'])
        .getMany();

        if (channels.length === 1) {
            this.channelRepository.deleteChannelByChannelId
        }
    }

    async updateUserTypeOfUCBridge(userId: number, channelId: number, newType: UserType) {
       await this.ucbRepository.updateUserTypeOfUCBridge(userId, channelId, newType);
    }


    async checkChannelPassword(channel: Channel, inputPwd: string): Promise<boolean> {
        if (await bcrypt.compare(inputPwd, channel.channel_pwd))
            return true;

        return false;
    }

    async checkDmRoomExists(senderId: number, receiverId: number): Promise<Channel> {
        let channelName = 'user' + senderId + ":" + 'user' + receiverId;
        const found1 = await this.channelRepository.getDmRoomByName(channelName);
        if (found1)
            return found1;

        channelName = 'user' + receiverId + ":" + 'user' + senderId;
        const found2 = await this.channelRepository.getDmRoomByName(channelName);
        if (found2)
            return found2;

        return null;
    }

    async getDMs(senderId: number, receiverId: number): Promise<Message[]> {
        let messages: Message[] = [];

        //sender가 receiver로부터 block되었는지 확인해야 함
        let channelName = "[DM]" + senderId + "&" + receiverId;
        let found = await this.getChannelByName(channelName);
        if (!found) {
            channelName = "[DM]" + receiverId + "&" + senderId;
            found = await this.getChannelByName(channelName);
        }

        messages = await this.getMessagesByChannelId(found.channel_id, senderId);

        return messages;
    }
    
    async isOwnerOfChannel(userId: number, channelId: number) {
        const found = await this.ucbRepository.getUcbByIds(userId, channelId);
        if (!found)
            throw new NotFoundException(`user ${userId} not found in channel ${channelId}`);

        if (found.user_type === UserType.OWNER)
            return true;
        return null;
    }

    async isAdminOfChannel(userId: number, channelId: number) {
        const found = await this.ucbRepository.getUcbByIds(userId, channelId);
        if (!found)
            throw new NotFoundException(`user ${userId} not found in channel ${channelId}`);

        if (found.user_type === UserType.ADMIN)
            return true;
        return null;
    }

    async updatePassword(channelId: number, newPassword: string): Promise<Channel> {
        const channel = await this.getChannelById(channelId);

        channel.salt = await bcrypt.genSalt();
        channel.channel_pwd = await bcrypt.hash(newPassword, channel.salt);

        await channel.save();
        return channel;
    }

    async setPasswordToChannel(joinChannelDto: JoinChannelDto) {
        const {channel_id, password} = joinChannelDto;

        const channel = await this.channelRepository.getChannelById(channel_id);
        if (!channel)
            throw new NotFoundException(`channel ${channel_id} not found`);

        channel.is_public = false;
        channel.salt = await bcrypt.genSalt();
        channel.channel_pwd = await bcrypt.hash(password, channel.salt);

        await channel.save();
    }

    async updateBanStatus(userId: number, channelId: number, newBanStatus: boolean): Promise<UserChannelBridge> {
        const found = await this.ucbRepository.getUcbByIds(userId, channelId);
        if (!found) {
            throw new NotFoundException(`user ${userId} not found in channel ${channelId}`);
        }
        found.is_banned = newBanStatus;
        await found.save();

        return found;
    }

    async updateMuteStatus(userId: number, channelId: number, newMuteStatus: boolean): Promise<UserChannelBridge> {
        const found = await this.ucbRepository.getUcbByIds(userId, channelId);
        if (!found) {
            throw new NotFoundException(`user ${userId} not found in channel ${channelId}`);
        }
        found.is_banned = newMuteStatus;
        await found.save();

        return found;
    }


    async getChannelByName(channelName: string): Promise<Channel> {
        return await this.channelRepository.getChannelByName(channelName);
    }

    async getChannelById(id: number): Promise<Channel> {
        return await this.channelRepository.getChannelById(id);
    }

    async JoinChannelById(id: number, user: User) {
        return await this.channelRepository.JoinChannelById(id, user);

    }

}
